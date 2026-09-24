// PROTOTYPE (issue #3): geometry helpers shared by the spike scripts. Throwaway.

const R = 6371000;

export function distance(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Points every `step` metres along a polyline of [lon, lat, ...] (linear interpolation).
export function resample(coords, step) {
  const out = [[coords[0][0], coords[0][1]]];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = distance(a, b);
    let t = step - carry;
    while (t <= d) {
      const f = t / d;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      t += step;
    }
    carry = d - (t - step);
  }
  const last = coords[coords.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

// Sum of positive differences. With a threshold, uses hysteresis: a climb only counts once the
// elevation has moved `threshold` metres away from the last retained point.
export function gain(z, threshold = 0) {
  let total = 0;
  let ref = z[0];
  for (const v of z) {
    if (threshold === 0) {
      if (v > ref) total += v - ref;
      ref = v;
    } else if (v - ref >= threshold) {
      total += v - ref;
      ref = v;
    } else if (ref - v >= threshold) {
      ref = v;
    }
  }
  return total;
}

// Centred moving average over `window` points (odd), shrinking at the ends.
export function smooth(z, window) {
  if (window <= 1) return z;
  const h = Math.floor(window / 2);
  return z.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(z.length - 1, i + h); j++) {
      s += z[j];
      n++;
    }
    return s / n;
  });
}
