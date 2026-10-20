package graphbuild

import "testing"

func TestSpillGivesBackItsBufferOnceMerged(t *testing.T) {
	// Arrange
	s := newSpill(t.TempDir(), "n", idRefCodec, 1000)
	for _, n := range []uint32{3, 1, 2} {
		if err := s.push(idRef{int64(n), 0}); err != nil {
			t.Fatal(err)
		}
	}

	// Act
	m, err := s.merge()
	if err != nil {
		t.Fatal(err)
	}
	var got []int64
	err = m.each(func(r idRef) error { got = append(got, r.id); return nil })

	// Assert: the buffer of a sort that is only read from now on is memory held for nothing
	if err != nil || len(got) != 3 || got[0] != 1 || got[2] != 3 {
		t.Fatalf("got %v, %v", got, err)
	}
	if cap(s.buf) != 0 {
		t.Errorf("the buffer still holds room for %d records", cap(s.buf))
	}
}

func TestSpillMergesManyRunsInOrder(t *testing.T) {
	// Arrange: runs of three, many equal ids that their position tells apart, pushed in a scrambled order
	s := newSpill(t.TempDir(), "n", idRefCodec, 3)
	const n = 200
	for i := uint32(0); i < n; i++ {
		k := (i * 7919) % n
		if err := s.push(idRef{int64(k % 13), k}); err != nil {
			t.Fatal(err)
		}
	}
	m, err := s.merge()
	if err != nil {
		t.Fatal(err)
	}
	var got []idRef

	// Act
	err = m.each(func(r idRef) error { got = append(got, r); return nil })

	// Assert
	if err != nil || len(got) != n {
		t.Fatalf("got %d records, %v", len(got), err)
	}
	for i := 1; i < n; i++ {
		if idRefCodec.cmp(got[i-1], got[i]) >= 0 {
			t.Fatalf("records %d and %d out of order: %v, %v", i-1, i, got[i-1], got[i])
		}
	}
}
