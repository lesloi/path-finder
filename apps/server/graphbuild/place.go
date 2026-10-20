package graphbuild

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// placed is what replaces a sort when each record knows its place in the output: n records whose indices are 0 to n-1,
// each once. The records go, as they come, to the partition of their index, with no sort; a partition is read back
// by putting each record at its place in a buffer of one partition. The memory is that of one partition, like the chunk
// of a sort, and the work is one pass where a sort compares and merges. A sort whose ties are broken by the order the
// records come in gives the same order, when that order is what the index counts.
type placed[R any] struct {
	dir, name string
	c         codec[R]
	index     func(R) uint32
	n, per    uint32
	files     []*os.File
	writers   []*bufio.Writer
	b         []byte
	bytes     int64
	written   bool
}

// The writers of a partition are small: a step can have hundreds of partitions open at once.
const placedWriter = 64 << 10

func newPlaced[R any](dir, name string, c codec[R], index func(R) uint32, n uint32, chunk int) *placed[R] {
	per := uint32(max(chunk, 1))
	parts := (uint64(n) + uint64(per) - 1) / uint64(per)
	return &placed[R]{
		dir: dir, name: name, c: c, index: index, n: n, per: per,
		files: make([]*os.File, parts), writers: make([]*bufio.Writer, parts), b: make([]byte, c.size),
	}
}

func (p *placed[R]) path(part int) string {
	return filepath.Join(p.dir, fmt.Sprintf("%s-%d.part", p.name, part))
}

func (p *placed[R]) push(r R) error {
	i := p.index(r)
	if i >= p.n {
		return fmt.Errorf("%s: index %d of %d records", p.name, i, p.n)
	}
	part := int(i / p.per)
	if p.writers[part] == nil {
		f, err := os.Create(p.path(part))
		if err != nil {
			return err
		}
		p.files[part], p.writers[part] = f, bufio.NewWriterSize(f, placedWriter)
	}
	p.c.put(p.b, r)
	_, err := p.writers[part].Write(p.b)
	p.bytes += int64(p.c.size)
	return err
}

// close ends the writing, once the last record is in.
func (p *placed[R]) close() error {
	if p.written {
		return nil
	}
	p.written = true
	for part, w := range p.writers {
		if w == nil {
			continue
		}
		err := w.Flush()
		if cerr := p.files[part].Close(); err == nil {
			err = cerr
		}
		if err != nil {
			return err
		}
	}
	p.files, p.writers = nil, nil
	return nil
}

// reader reads the records in the order of their index. It can be called again to read them again.
func (p *placed[R]) reader() (*placedReader[R], error) {
	if err := p.close(); err != nil {
		return nil, err
	}
	return &placedReader[R]{p: p, buf: make([]R, 0, min(p.per, p.n))}, nil
}

func (p *placed[R]) each(f func(R) error) error {
	r, err := p.reader()
	if err != nil {
		return err
	}
	for {
		rec, ok, err := r.next()
		if err != nil || !ok {
			return err
		}
		if err := f(rec); err != nil {
			return err
		}
	}
}

// finish adds what was written to the totals and removes the partitions.
func (p *placed[R]) finish(t *totals) {
	p.close()
	parts := int((uint64(p.n) + uint64(p.per) - 1) / uint64(p.per))
	for part := range parts {
		if os.Remove(p.path(part)) == nil {
			t.runs++
		}
	}
	t.bytes += p.bytes
	p.bytes = 0
}

type placedReader[R any] struct {
	p    *placed[R]
	part int
	buf  []R
	at   int
}

func (r *placedReader[R]) next() (rec R, ok bool, err error) {
	if r.at == len(r.buf) {
		if uint64(r.part)*uint64(r.p.per) >= uint64(r.p.n) {
			r.buf = nil
			return rec, false, nil
		}
		if err := r.load(); err != nil {
			return rec, false, err
		}
	}
	rec = r.buf[r.at]
	r.at++
	return rec, true, nil
}

// load reads the next partition and puts each record at its place; a place left empty or filled twice is a record
// lost on the way.
func (r *placedReader[R]) load() error {
	p := r.p
	base := uint32(r.part) * p.per
	size := min(p.per, p.n-base)
	r.buf, r.at = r.buf[:size], 0
	filled := make([]uint64, (size+63)/64)
	f, err := os.Open(p.path(r.part))
	if err != nil {
		return fmt.Errorf("%s: records %d to %d were lost on the way: %w", p.name, base, base+size-1, err)
	}
	defer f.Close()
	in := bufio.NewReaderSize(f, 1<<20)
	b := make([]byte, p.c.size)
	for {
		if _, err := io.ReadFull(in, b); err == io.EOF {
			break
		} else if err != nil {
			return err
		}
		rec := p.c.get(b)
		i := p.index(rec) - base
		if i >= size || filled[i/64]>>(i%64)&1 == 1 {
			return fmt.Errorf("%s: record %d came twice", p.name, i+base)
		}
		filled[i/64] |= 1 << (i % 64)
		r.buf[i] = rec
	}
	for i := uint32(0); i < size; i++ {
		if filled[i/64]>>(i%64)&1 == 0 {
			return fmt.Errorf("%s: record %d was lost on the way", p.name, i+base)
		}
	}
	r.part++
	return nil
}
