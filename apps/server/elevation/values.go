package elevation

import (
	"fmt"
	"io"
	"math"
	"strconv"
)

// pow10 holds the powers of ten a float64 stores exactly.
var pow10 = [...]float64{1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15}

// parseNumber gives what strconv.ParseFloat gives. A plain decimal of up to 15 digits is one exact integer over one
// exact power of ten, which a division rounds the way ParseFloat does; anything else goes to ParseFloat.
func parseNumber(b []byte) (float64, error) {
	i, neg := 0, false
	if len(b) > 0 && b[0] == '-' {
		i, neg = 1, true
	}
	var mant uint64
	digits, frac := 0, -1
	for ; i < len(b); i++ {
		c := b[i]
		switch {
		case c >= '0' && c <= '9':
			mant = mant*10 + uint64(c-'0')
			digits++
			if frac >= 0 {
				frac++
			}
		case c == '.' && frac < 0:
			frac = 0
		default:
			return parseSlow(b)
		}
	}
	if digits == 0 || digits > 15 {
		return parseSlow(b)
	}
	v := float64(mant)
	if frac > 0 {
		v /= pow10[frac]
	}
	if neg {
		v = -v
	}
	return v, nil
}

func parseSlow(b []byte) (float64, error) { return strconv.ParseFloat(string(b), 64) }

func isSpace(c byte) bool {
	return c == ' ' || c == '\n' || c == '\t' || c == '\r' || c == '\v' || c == '\f'
}

// readValues appends to dst the numbers r holds, separated by white space, as float32, a NaN for the nodata value. It
// reads in blocks and parses the bytes in place: a tile holds millions of values, and a string for each is most of its cost.
func readValues(r io.Reader, nodata float64, dst []float32) ([]float32, error) {
	buf := make([]byte, 1<<20)
	n := 0
	for {
		m, rerr := r.Read(buf[n:])
		n += m
		i := 0
		for i < n {
			for i < n && isSpace(buf[i]) {
				i++
			}
			start := i
			for i < n && !isSpace(buf[i]) {
				i++
			}
			if start == i {
				break
			}
			if i == n && rerr == nil { // the token may go on in the next block
				i = start
				break
			}
			v, err := parseNumber(buf[start:i])
			if err != nil {
				return dst, err
			}
			if v == nodata {
				dst = append(dst, float32(math.NaN()))
			} else {
				dst = append(dst, float32(v))
			}
		}
		n = copy(buf, buf[i:n])
		switch {
		case rerr == io.EOF:
			return dst, nil
		case rerr != nil:
			return dst, rerr
		case n == len(buf):
			return dst, fmt.Errorf("a value of more than %d bytes", len(buf))
		}
	}
}
