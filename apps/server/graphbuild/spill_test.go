package graphbuild

import "testing"

func TestSpillGivesBackItsBufferOnceMerged(t *testing.T) {
	// Arrange
	s := newSpill(t.TempDir(), "n", nodeElevCodec, 1000)
	for _, n := range []uint32{3, 1, 2} {
		if err := s.push(nodeElev{n, 0}); err != nil {
			t.Fatal(err)
		}
	}

	// Act
	m, err := s.merge()
	if err != nil {
		t.Fatal(err)
	}
	var got []uint32
	err = m.each(func(r nodeElev) error { got = append(got, r.node); return nil })

	// Assert: the buffer of a sort that is only read from now on is memory held for nothing
	if err != nil || len(got) != 3 || got[0] != 1 || got[2] != 3 {
		t.Fatalf("got %v, %v", got, err)
	}
	if cap(s.buf) != 0 {
		t.Errorf("the buffer still holds room for %d records", cap(s.buf))
	}
}
