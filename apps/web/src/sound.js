// Quiet fight sounds, made in the browser with Web Audio (no sound files).
// The player says what happened (a hit, a knockout, a boss arriving); this
// turns it into a short, soft sound. A limiter keeps busy fights from
// turning into noise, and the mute choice is remembered.

const VOLUME = 0.07; // master level: background, not foreground

/**
 * How often sounds may play: each kind waits its own gap, and all of them
 * together are capped per second.
 * @param {{ gaps: Record<string, number>, perSecond: number }} o  gaps in ms
 */
export function createLimiter({ gaps, perSecond }) {
  const last = new Map();
  const recent = [];
  return {
    allow(kind, now) {
      const gap = gaps[kind] ?? 0;
      if (last.has(kind) && now - last.get(kind) < gap) return false;
      while (recent.length && now - recent[0] >= 1000) recent.shift();
      if (recent.length >= perSecond) return false;
      last.set(kind, now); recent.push(now);
      return true;
    },
  };
}

/** The sound for a story moment (a player 'spotlight' event), or null for none. */
export function cueFor(e) {
  switch (e.kind) {
    case 'boss': return 'boss';
    case 'boss-open': return 'shield';
    case 'boss-down': case 'duel-won': return 'win';
    case 'release': case 'release-day': return 'release';
    default: return null;
  }
}

const GAPS = { hit: 90, big: 140, spark: 120, pop: 220, boss: 1500, shield: 800, win: 600, release: 1200 };

/**
 * @param {{ muted: boolean }} o
 * @returns {{ play: (kind: string) => void, muted: boolean, setMuted: (m: boolean) => void, unlock: () => void, stats: { asked: number } }}
 */
export function createSound({ muted }) {
  let ctx = null, out = null;
  const limiter = createLimiter({ gaps: GAPS, perSecond: 8 });
  const stats = { asked: 0 };

  /** Browsers start audio only after the viewer touches the page; call this from a click or key. */
  function unlock() {
    if (muted) return;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        out = ctx.createGain(); out.gain.value = VOLUME;
        const soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 5000; // nothing shrill
        out.connect(soft); soft.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch { ctx = null; }
  }

  const vary = (f) => f * (0.94 + Math.random() * 0.12); // a little variety between hits
  function tone(type, f0, f1, at, dur, level) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(out);
    o.start(at); o.stop(at + dur + 0.02);
  }
  let noiseBuf = null;
  function noise(at, dur, freq, level) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(at); s.stop(at + dur + 0.02);
  }

  const VOICES = {
    hit: (t) => { noise(t, 0.05, vary(1400), 0.5); tone('sine', vary(190), 90, t, 0.07, 0.5); },
    big: (t) => { noise(t, 0.09, vary(900), 0.6); tone('sine', vary(130), 48, t, 0.16, 0.8); },
    spark: (t) => tone('triangle', vary(880), vary(1320), t, 0.06, 0.25),
    pop: (t) => noise(t, 0.14, vary(2400), 0.25),
    boss: (t) => { tone('triangle', 110, 104, t, 0.32, 0.5); tone('triangle', 82, 78, t + 0.18, 0.4, 0.5); },
    shield: (t) => tone('triangle', 440, 880, t, 0.22, 0.35),
    win: (t) => [523, 659, 784].forEach((f, i) => tone('triangle', f, f, t + i * 0.08, 0.12, 0.3)),
    release: (t) => { tone('triangle', 659, 659, t, 0.14, 0.3); tone('triangle', 988, 988, t + 0.12, 0.22, 0.3); },
  };

  return {
    stats,
    get muted() { return muted; },
    setMuted(m) { muted = !!m; if (!muted) unlock(); else if (ctx && ctx.state === 'running') ctx.suspend(); },
    unlock,
    play(kind) {
      if (muted || !VOICES[kind] || !limiter.allow(kind, performance.now())) return;
      stats.asked++;
      if (!ctx || ctx.state !== 'running') return;
      try { VOICES[kind](ctx.currentTime + 0.005); } catch { /* audio unavailable */ }
    },
  };
}
