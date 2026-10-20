package graphbuild

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// pushAll pushes nodeElev records whose index is the node, in the given order.
func pushAll(t *testing.T, p *placed[nodeElev], nodes []uint32) {
	t.Helper()
	for _, n := range nodes {
		if err := p.push(nodeElev{n, int32(10 * n)}); err != nil {
			t.Fatal(err)
		}
	}
}

func readPlaced(p *placed[nodeElev]) ([]uint32, error) {
	var got []uint32
	err := p.each(func(r nodeElev) error {
		if r.elev != int32(10*r.node) {
			return errLost
		}
		got = append(got, r.node)
		return nil
	})
	return got, err
}

var errLost = errors.New("a record lost its value on the way")

func TestPlacedGivesTheRecordsInTheOrderOfTheirIndex(t *testing.T) {
	// Arrange: seven records over partitions of three, the last one partial
	p := newPlaced(t.TempDir(), "n", nodeElevCodec, nodeElevNode, 7, 3)
	pushAll(t, p, []uint32{5, 0, 6, 3, 1, 4, 2})

	// Act
	got, err := readPlaced(p)

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	for i, n := range got {
		if n != uint32(i) {
			t.Fatalf("got %v", got)
		}
	}
	if len(got) != 7 {
		t.Fatalf("got %d records, want 7", len(got))
	}
}

func TestPlacedGivesTheSameRecordsWhenReadTwice(t *testing.T) {
	// Arrange
	p := newPlaced(t.TempDir(), "n", nodeElevCodec, nodeElevNode, 5, 2)
	pushAll(t, p, []uint32{4, 2, 0, 3, 1})
	first, err := readPlaced(p)
	if err != nil {
		t.Fatal(err)
	}

	// Act
	second, err := readPlaced(p)

	// Assert
	if err != nil || len(second) != len(first) {
		t.Fatalf("got %v (%v), want %v", second, err, first)
	}
	for i := range first {
		if second[i] != first[i] {
			t.Fatalf("got %v, want %v", second, first)
		}
	}
}

func TestPlacedRefusesAMissingIndex(t *testing.T) {
	// Arrange: index 3 never comes
	p := newPlaced(t.TempDir(), "n", nodeElevCodec, nodeElevNode, 5, 2)
	pushAll(t, p, []uint32{4, 2, 0, 1})

	// Act
	_, err := readPlaced(p)

	// Assert
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestPlacedRefusesAnIndexGivenTwice(t *testing.T) {
	// Arrange: as many records as indices, but 2 twice and 3 never
	p := newPlaced(t.TempDir(), "n", nodeElevCodec, nodeElevNode, 5, 2)
	pushAll(t, p, []uint32{4, 2, 0, 1, 2})

	// Act
	_, err := readPlaced(p)

	// Assert
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestPlacedRefusesAnIndexBeyondItsCount(t *testing.T) {
	// Arrange
	p := newPlaced(t.TempDir(), "n", nodeElevCodec, nodeElevNode, 3, 2)

	// Act
	err := p.push(nodeElev{3, 0})

	// Assert
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestPlacedLeavesNoFileOnceFinished(t *testing.T) {
	// Arrange
	dir := t.TempDir()
	p := newPlaced(dir, "n", nodeElevCodec, nodeElevNode, 4, 2)
	pushAll(t, p, []uint32{3, 2, 1, 0})
	if _, err := readPlaced(p); err != nil {
		t.Fatal(err)
	}
	var tot totals

	// Act
	p.finish(&tot)

	// Assert
	if n := entries(t, dir); n != 0 {
		t.Errorf("%d files left", n)
	}
	if tot.runs != 2 || tot.bytes != 4*int64(nodeElevCodec.size) {
		t.Errorf("totals %+v, want 2 partitions of %d bytes in all", tot, 4*nodeElevCodec.size)
	}
}

func TestPlacedNamesARecordFoundInAnotherPartition(t *testing.T) {
	// Arrange: the record of index 0 also written in the file of the second partition
	p := newPlaced(t.TempDir(), "n", nodeElevCodec, nodeElevNode, 4, 2)
	pushAll(t, p, []uint32{0, 1, 2, 3})
	if err := p.close(); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(filepath.Join(p.dir, p.path(1)), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	b := make([]byte, nodeElevCodec.size)
	nodeElevCodec.put(b, nodeElev{0, 0})
	if _, err := f.Write(b); err != nil {
		t.Fatal(err)
	}
	f.Close()

	// Act
	_, err = readPlaced(p)

	// Assert: it is a record in the wrong place, not one that came twice
	if err == nil || !strings.Contains(err.Error(), "partition") {
		t.Fatalf("error %v", err)
	}
}
