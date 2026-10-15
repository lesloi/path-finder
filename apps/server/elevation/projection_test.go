package elevation

import (
	"math"
	"testing"
)

func TestParseProjection(t *testing.T) {
	for _, name := range []string{"lambert93", "utm20n", "utm21n", "utm22n", "utm38s", "utm40s"} {
		if p, err := ParseProjection(name); err != nil || p == nil {
			t.Errorf("ParseProjection(%q) = %v, %v", name, p, err)
		}
	}
	for _, name := range []string{"", "utm", "utm61n", "utm0s", "utm20", "wgs84", "UTM20N "} {
		if _, err := ParseProjection(name); err == nil {
			t.Errorf("ParseProjection(%q): err = nil", name)
		}
	}
}

func TestUTMOnTheCentralMeridian(t *testing.T) {
	cases := []struct {
		name         string
		lat, lon     float64
		wantX, wantY float64
	}{
		// x is the false easting on the central meridian, and y the false northing on the equator.
		{"utm20n", 0, -63, 500_000, 0},
		{"utm22n", 0, -51, 500_000, 0},
		{"utm38s", 0, 45, 500_000, 10_000_000},
		{"utm40s", 0, 57, 500_000, 10_000_000},
		// On the central meridian, y is k0 times the arc from the equator, about 4 984 944.4 m up to 45°N.
		{"utm20n", 45, -63, 500_000, 0.9996 * 4_984_944.378},
	}
	for _, c := range cases {
		p, err := ParseProjection(c.name)
		if err != nil {
			t.Fatal(err)
		}
		if x, y := p.Forward(c.lat, c.lon); math.Abs(x-c.wantX) > 0.01 || math.Abs(y-c.wantY) > 0.01 {
			t.Errorf("%s at (%v, %v) = %.3f, %.3f, want %.0f, %.0f", c.name, c.lat, c.lon, x, y, c.wantX, c.wantY)
		}
	}
}

func TestUTMOfAKnownPoint(t *testing.T) {
	// The Empire State Building, 40.7484°N 73.9857°W, is 18T 585628 E 4511322 N (UTM 18N is not a name
	// ParseProjection knows, so the zone is built directly).
	x, y := newUTM(18, false).Forward(40.7484, -73.9857)
	if math.Abs(x-585_628) > 25 || math.Abs(y-4_511_322) > 25 {
		t.Errorf("Empire State Building = %.0f, %.0f", x, y)
	}
}

func TestUTMRoundTripsThroughAnIndependentInverse(t *testing.T) {
	cases := []struct {
		zone     int
		south    bool
		lat, lon float64
	}{
		{20, false, 16.2411, -61.5331}, // Pointe-à-Pitre
		{20, false, 14.6161, -61.0588}, // Fort-de-France
		{22, false, 4.9224, -52.3135},  // Cayenne
		{40, true, -20.8789, 55.4481},  // Saint-Denis, Réunion
		{38, true, -12.7809, 45.2278},  // Mamoudzou
		{21, false, 46.7811, -56.1764}, // Saint-Pierre
		{20, false, 18.0731, -63.0822}, // Marigot
	}
	for _, c := range cases {
		x, y := newUTM(c.zone, c.south).Forward(c.lat, c.lon)
		lat, lon := utmInverse(c.zone, c.south, x, y)
		if math.Abs(lat-c.lat) > 1e-8 || math.Abs(lon-c.lon) > 1e-8 {
			t.Errorf("zone %d: (%v, %v) -> (%.0f, %.0f) -> (%.9f, %.9f)", c.zone, c.lat, c.lon, x, y, lat, lon)
		}
	}
}

// utmInverse is the textbook Krüger inverse, with its own coefficients, so that it checks the forward one.
func utmInverse(zone int, south bool, x, y float64) (lat, lon float64) {
	const a, k0 = 6378137.0, 0.9996
	f := 1 / 298.257222101
	n := f / (2 - f)
	bigA := a / (1 + n) * (1 + n*n/4 + n*n*n*n/64)
	beta := [4]float64{
		n/2 - 2*n*n/3 + 37*n*n*n/96 - n*n*n*n/360,
		n*n/48 + n*n*n/15 - 437*n*n*n*n/1440,
		17*n*n*n/480 - 37*n*n*n*n/840,
		4397 * n * n * n * n / 161280,
	}
	delta := [4]float64{
		2*n - 2*n*n/3 - 2*n*n*n + 116*n*n*n*n/45,
		7*n*n/3 - 8*n*n*n/5 - 227*n*n*n*n/45,
		56*n*n*n/15 - 136*n*n*n*n/35,
		4279 * n * n * n * n / 630,
	}
	y0 := 0.0
	if south {
		y0 = 10_000_000
	}
	xi, eta := (y-y0)/(k0*bigA), (x-500_000)/(k0*bigA)
	xi1, eta1 := xi, eta
	for j := 1; j <= 4; j++ {
		xi1 -= beta[j-1] * math.Sin(2*float64(j)*xi) * math.Cosh(2*float64(j)*eta)
		eta1 -= beta[j-1] * math.Cos(2*float64(j)*xi) * math.Sinh(2*float64(j)*eta)
	}
	chi := math.Asin(math.Sin(xi1) / math.Cosh(eta1))
	phi := chi
	for j := 1; j <= 4; j++ {
		phi += delta[j-1] * math.Sin(2*float64(j)*chi)
	}
	lon0 := float64(6*zone-183) * rad
	lam := lon0 + math.Atan2(math.Sinh(eta1), math.Cos(xi1))
	return phi / rad, lam / rad
}
