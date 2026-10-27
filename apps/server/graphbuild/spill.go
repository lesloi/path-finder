package graphbuild

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
)

// codec is what a step on disk needs to know of its records: how big they are on disk and how they are written and read;
// for a sort (see spill), in which order they come out. Records that compare equal come out in no particular order, so
// each sort names a key that tells its records apart whenever the order of the output depends on it.
type codec[R any] struct {
	size int
	put  func(b []byte, r R)
	get  func(b []byte) R
	cmp  func(a, b R) int
}

// spill gathers records up to a chunk, sorts them and writes them as a run: the memory of a sort is a chunk, whatever
// the number of records. merge reads every run back in order. The chunk is two buffers: one is sorted and written in the
// background while the other fills, so that the step that makes the records does not wait for the disk.
type spill[R any] struct {
	dir, name  string
	c          codec[R]
	half       int
	buf, spare []R
	writing    chan error // the run being written, nil when none is
	runs       []string
	bytes      int64
}

func newSpill[R any](dir, name string, c codec[R], chunk int) *spill[R] {
	return &spill[R]{dir: dir, name: name, c: c, half: max(chunk/2, 1)}
}

func (s *spill[R]) push(r R) error {
	if len(s.buf) == cap(s.buf) && cap(s.buf) < s.half {
		// It grows by doubling up to its half of the chunk and never past it: a small input holds a small buffer, and a
		// big one does not hold the room that append would leave beyond it.
		grown := make([]R, len(s.buf), min(max(2*cap(s.buf), 1<<10), s.half))
		copy(grown, s.buf)
		s.buf = grown
	}
	s.buf = append(s.buf, r)
	if len(s.buf) >= s.half {
		return s.flushInBackground()
	}
	return nil
}

// wait waits for the run being written, and says how its writing went. A step that may stop early defers it, so that no
// run is still being written when the scratch directory is removed.
func (s *spill[R]) wait() error {
	if s.writing == nil {
		return nil
	}
	err := <-s.writing
	s.writing = nil
	return err
}

// nextRun names the next run and counts what it holds.
func (s *spill[R]) nextRun(records []R) string {
	path := filepath.Join(s.dir, fmt.Sprintf("%s-%d.run", s.name, len(s.runs)))
	s.runs = append(s.runs, path)
	s.bytes += int64(len(records) * s.c.size)
	return path
}

// flushInBackground writes the full buffer as a run while the other one fills; a run that fails says so at the next
// flush, or at the merge.
func (s *spill[R]) flushInBackground() error {
	if err := s.wait(); err != nil {
		return err
	}
	full := s.buf
	s.buf, s.spare = s.spare[:0], full
	path, c, done := s.nextRun(full), s.c, make(chan error, 1)
	s.writing = done
	go func() {
		slices.SortFunc(full, c.cmp)
		done <- writeRun(path, c, full)
	}()
	return nil
}

// flush writes what the buffer holds, once the run being written is done; it is sorted while that one is written.
func (s *spill[R]) flush() error {
	slices.SortFunc(s.buf, s.c.cmp)
	if err := s.wait(); err != nil {
		return err
	}
	if len(s.buf) == 0 {
		return nil
	}
	if err := writeRun(s.nextRun(s.buf), s.c, s.buf); err != nil {
		return err
	}
	s.buf = s.buf[:0]
	return nil
}

// writeRun writes records, sorted, as the run at path.
func writeRun[R any](path string, c codec[R], records []R) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	b := make([]byte, c.size)
	for _, r := range records {
		c.put(b, r)
		if _, err := w.Write(b); err != nil {
			f.Close()
			return err
		}
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// blockBytes is how much a reader reads at a time: a record then costs one call per few KB instead of one per record,
// and the codec still decodes it from where it lies in the block.
const blockBytes = 32 << 10

// block reads records from a reader a block at a time, and decodes them one by one from the block it holds.
type block[R any] struct {
	r   *bufio.Reader
	c   codec[R]
	buf []byte
	at  int // the first byte of the next record
}

func newBlock[R any](r *bufio.Reader, c codec[R]) *block[R] {
	return newBlockSize(r, c, blockBytes)
}

// newBlockSize is newBlock with blocks of up to size bytes, of whole records.
func newBlockSize[R any](r *bufio.Reader, c codec[R], size int) *block[R] {
	buf := make([]byte, max(size/c.size, 1)*c.size)
	return &block[R]{r: r, c: c, buf: buf, at: len(buf)} // empty: the first record fills it
}

// next reads the record at the front of the block; ok is false at the end of the reader, which may fall between two
// records but never within one: a record cut short is io.ErrUnexpectedEOF.
func (b *block[R]) next() (rec R, ok bool, err error) {
	if b.at == len(b.buf) {
		if ok, err := b.fill(); !ok || err != nil {
			return rec, false, err
		}
	}
	rec = b.c.get(b.buf[b.at : b.at+b.c.size])
	b.at += b.c.size
	return rec, true, nil
}

// fill reads the next block, whole records only: the last one is short when the reader ends between two records.
func (b *block[R]) fill() (ok bool, err error) {
	n, err := io.ReadFull(b.r, b.buf)
	switch err {
	case nil:
		b.at = 0
		return true, nil
	case io.EOF:
		return false, nil
	case io.ErrUnexpectedEOF:
		if n%b.c.size != 0 {
			return false, io.ErrUnexpectedEOF
		}
		b.buf, b.at = b.buf[:n], 0
		return true, nil
	default:
		return false, err
	}
}

// merge reads everything back in order, once the last record is in. It can be called again to read the records again.
func (s *spill[R]) merge() (*merger[R], error) {
	if err := s.flush(); err != nil {
		return nil, err
	}
	// The records are all on disk now, and the buffers would stay until finish, beside the buffers of the sorts that follow.
	s.buf, s.spare = nil, nil
	m := &merger[R]{c: s.c}
	for i, p := range s.runs {
		f, err := os.Open(p)
		if err != nil {
			m.close()
			return nil, err
		}
		m.files = append(m.files, f)
		m.blocks = append(m.blocks, newBlock(bufio.NewReaderSize(f, 1<<20), s.c))
		rec, ok, err := m.blocks[i].next()
		if err != nil {
			m.close()
			return nil, err
		}
		if ok {
			m.items = append(m.items, headItem[R]{rec, i})
		}
	}
	for k := len(m.items)/2 - 1; k >= 0; k-- {
		m.down(k)
	}
	return m, nil
}

// finish adds what was written to the totals and removes the runs: the disk of a step is freed as soon as it is read.
func (s *spill[R]) finish(t *totals) {
	s.wait() // a build that failed may leave a run being written: it is removed with the others
	t.runs += len(s.runs)
	t.bytes += s.bytes
	for _, p := range s.runs {
		os.Remove(p)
	}
	s.runs, s.buf, s.spare = nil, nil, nil
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
	c      codec[R]
	files  []*os.File
	blocks []*block[R]
	items  []headItem[R]
}

func (m *merger[R]) less(a, b headItem[R]) bool {
	if c := m.c.cmp(a.rec, b.rec); c != 0 {
		return c < 0
	}
	return a.run < b.run
}

// down moves the record at k down to its place in the heap. It is written for the records, not through container/heap,
// whose interface calls cost more than the comparison: this runs once per record.
func (m *merger[R]) down(k int) {
	items := m.items
	for {
		c := 2*k + 1
		if c >= len(items) {
			return
		}
		if c+1 < len(items) && m.less(items[c+1], items[c]) {
			c++
		}
		if !m.less(items[c], items[k]) {
			return
		}
		items[k], items[c] = items[c], items[k]
		k = c
	}
}

// refill puts the next record of the run of the top of the heap in its place, or takes the run out at its end.
func (m *merger[R]) refill() error {
	rec, ok, err := m.blocks[m.items[0].run].next()
	if err != nil {
		return err
	}
	if ok {
		m.items[0].rec = rec
	} else {
		last := len(m.items) - 1
		m.items[0] = m.items[last]
		m.items = m.items[:last]
	}
	m.down(0)
	return nil
}

func (m *merger[R]) next() (r R, ok bool, err error) {
	if len(m.items) == 0 {
		m.close()
		return r, false, nil
	}
	top := m.items[0]
	if err := m.refill(); err != nil {
		m.close()
		return r, false, err
	}
	return top.rec, true, nil
}

// each closes the merge whatever way f or the reading ends, so that a caller cannot leave the runs open.
func (m *merger[R]) each(f func(R) error) error {
	defer m.close()
	for {
		r, ok, err := m.next()
		if err != nil || !ok {
			return err
		}
		if err := f(r); err != nil {
			return err
		}
	}
}

func (m *merger[R]) close() {
	for _, f := range m.files {
		f.Close()
	}
	m.files, m.blocks = nil, nil
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
	return createTableSize(dir, name, c, 1<<20)
}

// createTableSize is createTable with a writer of size bytes.
func createTableSize[R any](dir, name string, c codec[R], size int) (*table[R], error) {
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	return &table[R]{path: path, c: c, f: f, w: bufio.NewWriterSize(f, size), b: make([]byte, c.size)}, nil
}

func (t *table[R]) put(r R) error {
	t.c.put(t.b, r)
	_, err := t.w.Write(t.b)
	return err
}

// finish is safe to defer after a later finish: the error paths of a build close their tables this way.
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

func (t *table[R]) reader() (*tableReader[R], error) {
	if err := t.finish(); err != nil {
		return nil, err
	}
	f, err := os.Open(t.path)
	if err != nil {
		return nil, err
	}
	return &tableReader[R]{f: f, b: newBlock(bufio.NewReaderSize(f, 1<<20), t.c)}, nil
}

type tableReader[R any] struct {
	f *os.File
	b *block[R]
}

func (t *tableReader[R]) next() (r R, err error) {
	rec, ok, err := t.b.next()
	if err == nil && !ok {
		err = io.EOF
	}
	if err != nil {
		return rec, fmt.Errorf("a record was lost on the way: %w", err)
	}
	return rec, nil
}

func (t *tableReader[R]) close() { t.f.Close() }
