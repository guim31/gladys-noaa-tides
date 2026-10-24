// -----------------------------------------------------------------------------
// Tide arithmetic, pure functions on the NOAA predictions:
//   - extremes: the high and low tides, `{ at, height, type: 'H' | 'L' }`;
//   - curve: the predicted level every 6 minutes, `{ at, height }` (reference
//     stations only: a subordinate station has its high and low tides only).
// Instants are epoch milliseconds, heights metres above MLLW.
// -----------------------------------------------------------------------------

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const TIDE_TYPES = { H: 'high', L: 'low' };

/**
 * The level between two extremes, by the cosine interpolation of the tide
 * tables (the curve of a semi-diurnal tide): exact at both ends, a few
 * centimetres off in between.
 */
export function cosineLevel(previous, next, at) {
  const phase = (Math.PI * (at - previous.at)) / (next.at - previous.at);
  return (
    (previous.height + next.height) / 2 + ((previous.height - next.height) / 2) * Math.cos(phase)
  );
}

/** Index of the first extreme after `at` (strictly), or -1. */
const nextIndex = (extremes, at) => extremes.findIndex((tide) => tide.at > at);

/**
 * The predicted level at `at`: the 6-minute curve when it covers that instant
 * (linear between two points), else the cosine between the surrounding high
 * and low tides. Null when the predictions do not cover it.
 */
export function levelAt({ curve = [], extremes = [] }, at) {
  if (curve.length > 1 && curve[0].at <= at && at <= curve.at(-1).at) {
    const after = curve.findIndex((point) => point.at >= at);
    const b = curve[after];
    if (b.at === at || after === 0) {
      return b.height;
    }
    const a = curve[after - 1];
    return a.height + ((b.height - a.height) * (at - a.at)) / (b.at - a.at);
  }
  const index = nextIndex(extremes, at);
  if (index <= 0) {
    return null;
  }
  return cosineLevel(extremes[index - 1], extremes[index], at);
}

/** The next tide after `at`, of a type ('H', 'L') or of any; null if unknown. */
export function nextTide(extremes = [], at, type = null) {
  return extremes.find((tide) => tide.at > at && (type === null || tide.type === type)) ?? null;
}

/** 'rising' before a high tide, 'falling' before a low tide, null if unknown. */
export function trendAt(extremes = [], at) {
  const next = nextTide(extremes, at);
  if (!next) {
    return null;
  }
  return next.type === 'H' ? 'rising' : 'falling';
}

/** Whole minutes from `from` to `to`, rounded (0 at the minute of the tide). */
export const minutesBetween = (from, to) => Math.max(0, Math.round((to - from) / MINUTE));

/**
 * The predicted level every `stepMs` from `from` to `to`, for a chart: the
 * curve where it exists, the cosine elsewhere. Points without a prediction are
 * left out.
 */
export function series(predictions, from, to, stepMs = 6 * MINUTE) {
  const points = [];
  for (let at = from; at <= to; at += stepMs) {
    const height = levelAt(predictions, at);
    if (height !== null) {
      points.push({ at, height });
    }
  }
  return points;
}
