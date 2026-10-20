package elevation

import (
	"errors"
	"io"
	"math"
	"strconv"
	"strings"
	"testing"
	"testing/iotest"
)

func TestReadValuesGivesWhatParseFloatGives(t *testing.T) {
	// Arrange
	tokens := []string{"0", "-0", "1", "123.45", "-99999", "-99999.00", "0.1", "5.", ".5", "+5", "1e3", "1.5E-2",
		"0.1234567890123456789", "1234567890123456", "98765.4321098765", "1.7976931348623157e308", "inf", "NaN"}
	input := strings.Join(tokens, " \t\r\n ") + "\n"

	// Act
	got, err := readValues(strings.NewReader(input), -99999, make([]float32, 0, len(tokens)))

	// Assert
	if err != nil || len(got) != len(tokens) {
		t.Fatalf("got %d values, error %v; want %d", len(got), err, len(tokens))
	}
	for i, s := range tokens {
		want, _ := strconv.ParseFloat(s, 64)
		w := float32(want)
		if want == -99999 {
			w = float32(math.NaN())
		}
		if g := got[i]; g != w && !(g != g && w != w) || math.Signbit(float64(g)) != math.Signbit(float64(w)) {
			t.Errorf("%q: got %v, want %v", s, g, w)
		}
	}
}

func TestReadValuesJoinsATokenCutByTheBuffer(t *testing.T) {
	// Arrange: a reader that gives one byte at a time cuts every token.
	input := strings.NewReader("12.5 -3.25\n7 ")

	// Act
	got, err := readValues(iotest.OneByteReader(input), -99999, nil)

	// Assert
	if err != nil || len(got) != 3 || got[0] != 12.5 || got[1] != -3.25 || got[2] != 7 {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestReadValuesReadsALastTokenWithNoNewline(t *testing.T) {
	// Arrange / Act
	got, err := readValues(strings.NewReader("1 2 3"), -99999, nil)

	// Assert
	if err != nil || len(got) != 3 || got[2] != 3 {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestReadValuesRefusesWhatIsNotANumber(t *testing.T) {
	// Arrange / Act
	_, err := readValues(strings.NewReader("1 2 abc 4"), -99999, nil)

	// Assert
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestReadValuesReportsAReadError(t *testing.T) {
	// Arrange
	r := io.MultiReader(strings.NewReader("1 2 "), iotest.ErrReader(io.ErrUnexpectedEOF))

	// Act
	_, err := readValues(r, -99999, nil)

	// Assert
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("got %v", err)
	}
}

func TestReadValuesRefusesAValueThatFillsTheBuffer(t *testing.T) {
	// Arrange
	r := strings.NewReader(strings.Repeat("1", 1<<20+1))

	// Act
	_, err := readValues(r, -99999, nil)

	// Assert
	if err == nil {
		t.Fatal("expected an error")
	}
}
