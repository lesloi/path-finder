package graphbuild

import (
	"bufio"
	"container/heap"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
)

// codec is what a sort on disk needs to know of its records: how big they are on disk, how they are written and read, and
// in which order they come out. Records that compare equal come out in no particular order, so each sort names a key
// that tells its records apart whenever the order of the output depends on it.
type codec[R any] struct {
	size int
	put  func(b []byte, r R)
	get  func(b []byte) R
	cmp  func(a, b R) int
}

// spill gathers records up to a chunk, sorts them and writes them as a run: the memory of a sort is a chunk, whatever
// the number of records. merge reads every run back in order.
type spill[R any] struct {
	dir, name string
	c         codec[R]
	chunk     int
	buf       []R
	runs      []string
	bytes     int64
}

func newSpill[R any](dir, name string, c codec[R], chunk int) *spill[R] {
	return &spill[R]{dir: dir, name: name, c: c, chunk: max(chunk, 1)}
}

func (s *spill[R]) push(r R) error {
	if s.buf == nil {
		s.buf = make([]R, 0, s.chunk) // the whole chunk at once: growing it by appends would hold twice as much for a while
	}
	s.buf = append(s.buf, r)
	if len(s.buf) >= s.chunk {
		return s.flush()
	}
	return nil
}

func (s *spill[R]) flush() error {
	if len(s.buf) == 0 {
		return nil
	}
	slices.SortFunc(s.buf, s.c.cmp)
	path := filepath.Join(s.dir, fmt.Sprintf("%s-%d.run", s.name, len(s.runs)))
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	b := make([]byte, s.c.size)
	for _, r := range s.buf {
		s.c.put(b, r)
		if _, err := w.Write(b); err != nil {
			f.Close()
			return err
		}
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	s.bytes += int64(len(s.buf) * s.c.size)
	s.buf = s.buf[:0]
	s.runs = append(s.runs, path)
	return nil
}

// merge reads everything back in order, once the last record is in. It can be called again to read the records again.
func (s *spill[R]) merge() (*merger[R], error) {
	if err := s.flush(); err != nil {
		return nil, err
	}
	m := &merger[R]{c: s.c}
	for i, p := range s.runs {
		f, err := os.Open(p)
		if err != nil {
			m.close()
			return nil, err
		}
		m.files = append(m.files, f)
		m.readers = append(m.readers, bufio.NewReaderSize(f, 1<<20))
		if err := m.refill(i, -1); err != nil {
			m.close()
			return nil, err
		}
	}
	return m, nil
}

// finish adds what was written to the totals and removes the runs: the disk of a step is freed as soon as it is read.
func (s *spill[R]) finish(t *totals) {
	t.runs += len(s.runs)
	t.bytes += s.bytes
	for _, p := range s.runs {
		os.Remove(p)
	}
	s.runs, s.buf = nil, nil
}

type totals struct {
	runs  int
	bytes int64
}

type headItem[R any] struct {
	rec R
	run int
}

// merger reads sorted runs as one sorted stream, with a heap holding the next record of each run.
type merger[R any] struct {
	c       codec[R]
	files   []*os.File
	readers []*bufio.Reader
	items   []headItem[R]
	b       []byte
}

func (m *merger[R]) Len() int           { return len(m.items) }
func (m *merger[R]) Swap(i, j int)      { m.items[i], m.items[j] = m.items[j], m.items[i] }
func (m *merger[R]) Less(i, j int) bool { return m.less(m.items[i], m.items[j]) }
func (m *merger[R]) Push(any)           { panic("the merger is filled by refill") }
func (m *merger[R]) Pop() any           { panic("the merger is emptied by next") }

func (m *merger[R]) less(a, b headItem[R]) bool {
	if c := m.c.cmp(a.rec, b.rec); c != 0 {
		return c < 0
	}
	return a.run < b.run
}

// refill reads the next record of run i. A replaced is the position in the heap of the record that was taken from the
// run, or -1 at the start, when the heap does not hold it yet.
func (m *merger[R]) refill(i, replaced int) error {
	if m.b == nil {
		m.b = make([]byte, m.c.size)
	}
	_, err := io.ReadFull(m.readers[i], m.b)
	switch {
	case err == nil:
		it := headItem[R]{m.c.get(m.b), i}
		if replaced < 0 {
			m.items = append(m.items, it)
			// Sifting up by hand keeps the records out of an interface: this runs once per record.
			for k := len(m.items) - 1; k > 0; {
				p := (k - 1) / 2
				if !m.less(m.items[k], m.items[p]) {
					break
				}
				m.items[k], m.items[p] = m.items[p], m.items[k]
				k = p
			}
		} else {
			m.items[replaced] = it
			heap.Fix(m, replaced)
		}
	case err == io.EOF:
		if replaced >= 0 {
			last := len(m.items) - 1
			m.items[replaced] = m.items[last]
			m.items = m.items[:last]
			if replaced < last {
				heap.Fix(m, replaced)
			}
		}
	default:
		return err
	}
	return nil
}

// next is the next record in order, and false once every run is read.
func (m *merger[R]) next() (r R, ok bool, err error) {
	if len(m.items) == 0 {
		m.close()
		return r, false, nil
	}
	top := m.items[0]
	if err := m.refill(top.run, 0); err != nil {
		m.close()
		return r, false, err
	}
	return top.rec, true, nil
}

func (m *merger[R]) close() {
	for _, f := range m.files {
		f.Close()
	}
	m.files, m.readers = nil, nil
}

// table is a file written in one go, record after record, and read back in the same order.
type table[R any] struct {
	path string
	c    codec[R]
	f    *os.File
	w    *bufio.Writer
	b    []byte
}

func createTable[R any](dir, name string, c codec[R]) (*table[R], error) {
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	return &table[R]{path: path, c: c, f: f, w: bufio.NewWriterSize(f, 1<<20), b: make([]byte, c.size)}, nil
}

func (t *table[R]) put(r R) error {
	t.c.put(t.b, r)
	_, err := t.w.Write(t.b)
	return err
}

// finish ends the writing.
func (t *table[R]) finish() error {
	if t.f == nil {
		return nil
	}
	err := t.w.Flush()
	if cerr := t.f.Close(); err == nil {
		err = cerr
	}
	t.f = nil
	return err
}

// reader ends the writing if it is not ended, and reads the file back: the same records in the same order.
func (t *table[R]) reader() (*tableReader[R], error) {
	if err := t.finish(); err != nil {
		return nil, err
	}
	f, err := os.Open(t.path)
	if err != nil {
		return nil, err
	}
	return &tableReader[R]{f: f, r: bufio.NewReaderSize(f, 1<<20), c: t.c, b: make([]byte, t.c.size)}, nil
}

type tableReader[R any] struct {
	f *os.File
	r *bufio.Reader
	c codec[R]
	b []byte
}

func (t *tableReader[R]) next() (r R, err error) {
	if _, err := io.ReadFull(t.r, t.b); err != nil {
		return r, fmt.Errorf("a record was lost on the way: %w", err)
	}
	return t.c.get(t.b), nil
}

func (t *tableReader[R]) close() { t.f.Close() }
