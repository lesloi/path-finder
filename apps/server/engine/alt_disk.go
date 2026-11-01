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

// columnBlockNodes is how many nodes a worker turns into bytes at a time: the block is written and reused, so a worker
// holds one distance per node plus a few MB, not a whole column as well.
const columnBlockNodes = 1 << 21

// WriteLandmarksOnDisk is WriteLandmarks for a graph whose rows do not fit in memory: the distances of each landmark are
// written to a file below tmp as soon as they are known, workers landmarks at a time (each worker holds one distance
// per node and writes its column in blocks), then the files are turned into rows in one pass. The file is the one
// WriteLandmarks writes.
func WriteLandmarksOnDisk(graphPath, path string, req LandmarkRequest, tmp string, workers int) error {
	return writeLandmarksOnDisk(graphPath, path, req, tmp, workers, rowsAtATime)
}

// landmarksPattern names the scratch directories: MkdirTemp puts a random string where the star is.
const landmarksPattern = "pf-landmarks-*"

func writeLandmarksOnDisk(graphPath, path string, req LandmarkRequest, tmp string, workers, rowsAt int) error {
	t0 := time.Now()
	p, g, up, err := openForLandmarks(graphPath, req)
	if err != nil {
		return err
	}
	defer g.file.unmap()
	count, mode := req.Count, req.Mode
	if tmp == "" {
		tmp = filepath.Dir(path) // never a memory-backed /tmp: the columns are as big as the rows
	}
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		return err
	}
	SweepScratch(tmp, landmarksPattern)
	dir, err := os.MkdirTemp(tmp, landmarksPattern)
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	marks := pickMarks(g, g.sp, p, mode, count)
	columns := count
	if up > 0 {
		columns = 2 * count
	}
	column := func(c int) string { return filepath.Join(dir, fmt.Sprintf("column-%d.u16", c)) }
	if err := writeColumns(g, p, mode, marks, count, columns, workers, column); err != nil {
		return err
	}
	head := newAltHead(count, uint32(g.n), g.fingerprint, mode, metricOf(req), req.Profile, up)
	err = writeAtomic(path, func(tmp string) error {
		return writeLandmarksWith(tmp, head, func(w *bufio.Writer) error {
			return transpose(w, g.n, columns, rowsAt, column)
		})
	})
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "landmarks: %d, climb %.0f, built on disk in %v\n", count, up, time.Since(t0).Round(time.Second))
	return nil
}

// writeColumns writes the quantized distances of each column to its file: the forward distances of the landmarks, then
// the backward ones when the profile counts the climb.
func writeColumns(g *graph, p *Profile, mode Mode, marks []uint32, count, columns, workers int, column func(int) string) error {
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
			block := make([]byte, 2*min(columnBlockNodes, g.n))
			var d dijkstra
			for c, ok := take(); ok; c, ok = take() {
				d.all(g, p, mode, marks[c%count], dist, p.UpPerMeter, c >= count)
				if err := writeColumn(column(c), dist, block); err != nil {
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

// writeColumn writes the quantized distances to path a block at a time, through block, which the caller reuses.
func writeColumn(path string, dist []float32, block []byte) (err error) {
	if len(block) < 2 {
		return fmt.Errorf("engine: a column block of %d bytes holds no distance", len(block))
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	// The scratch directory goes away with the build: a half-written column need not be removed here.
	defer func() {
		if cerr := f.Close(); err == nil {
			err = cerr
		}
	}()
	perBlock := len(block) / 2
	for start := 0; start < len(dist); start += perBlock {
		end := min(start+perBlock, len(dist))
		b := block[:2*(end-start)]
		for i, v := range dist[start:end] {
			q := quantize(v)
			b[2*i], b[2*i+1] = byte(q), byte(q>>8)
		}
		if _, err := f.Write(b); err != nil {
			return err
		}
	}
	return nil
}

// transpose turns the columns into rows, rowsAt nodes at a time: a row holds one distance from each column. The
// distances are 16-bit numbers, so each cell is a word rather than two bytes copied one by one.
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
	chunk := make([][]uint16, columns)
	for c := range chunk {
		chunk[c] = make([]uint16, rowsAt)
	}
	rows := make([]uint16, columns*rowsAt)
	for done := 0; done < n; {
		length := min(rowsAt, n-done)
		for c, r := range readers {
			if _, err := io.ReadFull(r, bytesOf(chunk[c][:length])); err != nil {
				return err
			}
		}
		for i := 0; i < length; i++ {
			for c := range chunk {
				rows[i*columns+c] = chunk[c][i]
			}
		}
		if _, err := w.Write(bytesOf(rows[:columns*length])); err != nil {
			return err
		}
		done += length
	}
	return nil
}
