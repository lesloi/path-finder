package engine

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// rowsAtATime is how many nodes are turned from columns into rows at a time.
const rowsAtATime = 1 << 16

// WriteLandmarksOnDisk is WriteLandmarks for a graph whose rows do not fit in memory: the distances of each landmark are
// written to a file below tmp as soon as they are known, workers landmarks at a time (each worker holds one distance
// per node), then the files are turned into rows in one pass. The file is the one WriteLandmarks writes.
func WriteLandmarksOnDisk(graphPath, path, profile string, count int, tmp string, workers int) error {
	return writeLandmarksOnDisk(graphPath, path, profile, count, tmp, workers, rowsAtATime)
}

func writeLandmarksOnDisk(graphPath, path, profile string, count int, tmp string, workers, rowsAt int) error {
	t0 := time.Now()
	p, g, perNode, err := openForLandmarks(graphPath, profile, count)
	if err != nil {
		return err
	}
	defer g.file.unmap()
	if tmp == "" {
		tmp = filepath.Dir(path) // never a memory-backed /tmp: the columns are as big as the rows
	}
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		return err
	}
	dir, err := os.MkdirTemp(tmp, "pf-landmarks-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	marks := pickMarks(g, g.sp, p, count)
	columns := count * perNode
	column := func(c int) string { return filepath.Join(dir, fmt.Sprintf("column-%d.u16", c)) }
	if err := writeColumns(g, p, marks, count, columns, workers, column); err != nil {
		return err
	}
	err = writeAtomic(path, func(tmp string) error {
		return writeLandmarksWith(tmp, count, uint32(g.n), g.fingerprint, p.UpPerMeter, func(w *bufio.Writer) error {
			return transpose(w, g.n, columns, rowsAt, column)
		})
	})
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "landmarks: %d, climb %.0f, built on disk in %v\n", count, p.UpPerMeter, time.Since(t0).Round(time.Second))
	return nil
}

// writeColumns writes the quantized distances of each column to its file: the forward distances of the landmarks, then
// the backward ones when the profile counts the climb.
func writeColumns(g *graph, p *Profile, marks []uint32, count, columns, workers int, column func(int) string) error {
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		next int
		fail error
	)
	take := func() (int, bool) {
		mu.Lock()
		defer mu.Unlock()
		if fail != nil || next >= columns {
			return 0, false
		}
		next++
		return next - 1, true
	}
	for range max(1, min(workers, columns)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			dist := make([]float32, g.n)
			b := make([]byte, 2*g.n)
			for c, ok := take(); ok; c, ok = take() {
				dijkstraAll(g, p, marks[c%count], dist, p.UpPerMeter, c >= count)
				for i, d := range dist {
					q := quantize(d)
					b[2*i], b[2*i+1] = byte(q), byte(q>>8)
				}
				if err := os.WriteFile(column(c), b, 0o644); err != nil {
					mu.Lock()
					fail = err
					mu.Unlock()
					return
				}
			}
		}()
	}
	wg.Wait()
	return fail
}

// transpose turns the columns into rows, rowsAt nodes at a time: a row holds one distance from each column.
func transpose(w io.Writer, n, columns, rowsAt int, column func(int) string) error {
	readers := make([]*bufio.Reader, columns)
	for c := range readers {
		f, err := os.Open(column(c))
		if err != nil {
			return err
		}
		defer f.Close()
		readers[c] = bufio.NewReaderSize(f, 1<<16)
	}
	chunk := make([][]byte, columns)
	for c := range chunk {
		chunk[c] = make([]byte, 2*rowsAt)
	}
	rows := make([]byte, 2*columns*rowsAt)
	for done := 0; done < n; {
		length := min(rowsAt, n-done)
		for c, r := range readers {
			if _, err := io.ReadFull(r, chunk[c][:2*length]); err != nil {
				return err
			}
		}
		for i := 0; i < length; i++ {
			for c := range chunk {
				copy(rows[2*(i*columns+c):], chunk[c][2*i:2*i+2])
			}
		}
		if _, err := w.Write(rows[:2*columns*length]); err != nil {
			return err
		}
		done += length
	}
	return nil
}
