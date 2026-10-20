// Splits a sorted commit list into chapters. Boundaries start as equal-size
// slices and then snap to a nearby release tag, so chapters tend to end on
// real releases ("v1.0.0") instead of arbitrary commits.

// a plain release tag, optionally labelled with its repo in a collection ("ky v1.0.0")
const SEMVER_RE = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)$/;

/** 3 = major (x.0.0), 2 = minor (x.y.0), 1 = patch, 0 = not a plain release tag. */
export function releaseWeight(tag) {
  const m = String(tag).match(SEMVER_RE);
  if (!m) return 0;
  if (m[2] === '0' && m[3] === '0') return m[1] === '0' ? 2 : 3;
  if (m[3] === '0') return 2;
  return 1;
}

export function bestTag(tags) {
  let best = null, bw = -1;
  for (const t of tags || []) { const w = releaseWeight(t); if (w > bw) { best = t; bw = w; } }
  return bw > 0 ? best : null;
}

/** How many chapters a history of `n` commits gets. */
export function chapterCount(n) {
  return Math.max(3, Math.min(9, Math.round(Math.sqrt(n / 250))));
}

/**
 * @param {{ tags: string[] }[]} commits  Sorted oldest first.
 * @param {{ chapters?: number }} [opts]
 * @returns {{ start: number, end: number, release: string|null }[]}  end is exclusive.
 */
export function splitChapters(commits, opts = {}) {
  const n = commits.length;
  const K = Math.max(1, Math.min(opts.chapters || chapterCount(n), Math.floor(n / 10) || 1));
  const tagged = [];
  commits.forEach((c, i) => { const t = bestTag(c.tags); if (t) tagged.push({ i, t, w: releaseWeight(t) }); });
  const bounds = [0];
  const slice = n / K;
  for (let k = 1; k < K; k++) {
    const ideal = Math.round(k * slice);
    const lo = Math.max(bounds[bounds.length - 1] + Math.ceil(slice * 0.35), Math.round(ideal - slice * 0.35));
    const hi = Math.min(n - Math.ceil(slice * 0.35), Math.round(ideal + slice * 0.35));
    let pick = null;
    for (const t of tagged) {
      const end = t.i + 1; // the tagged commit closes its chapter
      if (end < lo || end > hi) continue;
      if (!pick || t.w > pick.w || (t.w === pick.w && Math.abs(end - ideal) < Math.abs(pick.i + 1 - ideal))) pick = t;
    }
    const b = pick ? pick.i + 1 : Math.max(ideal, bounds[bounds.length - 1] + 1);
    bounds.push(Math.min(b, n - 1));
  }
  bounds.push(n);
  const out = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const start = bounds[k], end = bounds[k + 1];
    if (end <= start) continue;
    // The chapter's release: the strongest release tag inside it, latest on ties.
    let rel = null, rw = 0;
    for (let i = start; i < end; i++) { const t = bestTag(commits[i].tags); const w = t ? releaseWeight(t) : 0; if (w && w >= rw) { rel = t; rw = w; } }
    out.push({ start, end, release: rel });
  }
  return out;
}
