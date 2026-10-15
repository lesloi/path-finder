package elevation

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
)

// Projection turns a WGS84 point in degrees into the metres of the grid a BD ALTI tile is written in.
type Projection interface {
	Forward(latDeg, lonDeg float64) (x, y float64)
}

// utm is a Universal Transverse Mercator zone. The overseas BD ALTI tiles use it (RGAF09, RGFG95, RGR92,
// RGM04 and RGSPM06 differ from WGS84 by under a metre, less than a cell of 25 m).
type utm struct {
	lon0, k0, y0, bigA float64
	alpha              [4]float64
	twoRootN           float64 // 2·√n/(1+n)
}

const utmScale = 0.9996

// newUTM builds the zone (1 to 60) of the northern or southern hemisphere. It uses Krüger's series in n,
// exact to the millimetre across a zone.
func newUTM(zone int, south bool) utm {
	n := (1 - math.Sqrt(1-grsE*grsE)) / (1 + math.Sqrt(1-grsE*grsE))
	u := utm{
		lon0:     float64(6*zone-183) * rad,
		k0:       utmScale,
		bigA:     grsA / (1 + n) * (1 + n*n/4 + n*n*n*n/64),
		twoRootN: 2 * math.Sqrt(n) / (1 + n),
		alpha: [4]float64{
			n/2 - 2*n*n/3 + 5*n*n*n/16 + 41*n*n*n*n/180,
			13*n*n/48 - 3*n*n*n/5 + 557*n*n*n*n/1440,
			61*n*n*n/240 - 103*n*n*n*n/140,
			49561 * n * n * n * n / 161280,
		},
	}
	if south {
		u.y0 = 10_000_000
	}
	return u
}

func (u utm) Forward(latDeg, lonDeg float64) (x, y float64) {
	s := math.Sin(latDeg * rad)
	t := math.Sinh(math.Atanh(s) - u.twoRootN*math.Atanh(u.twoRootN*s))
	dl := lonDeg*rad - u.lon0
	xi := math.Atan2(t, math.Cos(dl))
	eta := math.Atanh(math.Sin(dl) / math.Hypot(1, t))
	sumX, sumY := eta, xi
	for j, a := range u.alpha {
		k := 2 * float64(j+1)
		sumX += a * math.Cos(k*xi) * math.Sinh(k*eta)
		sumY += a * math.Sin(k*xi) * math.Cosh(k*eta)
	}
	return 500_000 + u.k0*u.bigA*sumX, u.y0 + u.k0*u.bigA*sumY
}

var utmName = regexp.MustCompile(`^utm([1-9]|[1-5][0-9]|60)([ns])$`)

// ParseProjection resolves the name given to -dem-crs: "lambert93", or "utm" with a zone and a hemisphere,
// such as "utm20n".
func ParseProjection(name string) (Projection, error) {
	if name == "lambert93" {
		return l93, nil
	}
	if m := utmName.FindStringSubmatch(name); m != nil {
		zone, _ := strconv.Atoi(m[1])
		return newUTM(zone, m[2] == "s"), nil
	}
	return nil, fmt.Errorf("unknown projection %q: use lambert93, or utmZZn / utmZZs (utm20n, utm40s)", name)
}
