// The movie frame around the player's canvas: the date and running totals,
// the "active now" and commit-feed overlays, and the scrubbable timeline
// (weekly activity, chapters, releases, playhead). Every number comes from
// the story engine's timeline helpers, so the page and the player agree.

import { TL, weekBuckets, totalsAt, activeAt, commitRange, chapterAt, isoOfDay, dayOfIso, fixOf } from '@commit-wars/story-engine';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtN = (n) => Number(n).toLocaleString('en-US');
const fmtDate = (d) => { const [y, m, dd] = d.split('-'); return `${MON[+m - 1]} ${+dd}, ${y}`; };
const fmtShort = (d) => { const [, m, dd] = d.split('-'); return `${MON[+m - 1]} ${+dd}`; };
const plural = (n, w) => `${fmtN(n)} ${w}${n === 1 ? '' : /(x|s|ch)$/.test(w) ? 'es' : 's'}`;
const FEED_ROWS = 60;

/**
 * @param {{ player: any, movie: HTMLElement, screen: HTMLElement, onFollow: (name: string) => void }} o
 */
export function createMovieUI({ player, movie, screen, onFollow }) {
  const $ = (s) => movie.querySelector(s);
  const els = {
    date: $('#ovDate'), chapter: $('#ovChapter'), totals: $('#ovTotals'), people: $('#peopleList'), feed: $('#feedList'),
    feedNote: $('#feedNote'), peopleBox: $('#ovPeople'), feedBox: $('#ovFeed'), tl: $('#tlCanvas'), scrub: $('#scrub'), scrubBox: $('#scrubBox'),
  };
  let ep = null, tl = null, who = null, buckets = [], lastDay = -1, day = 0, layer = null, scrubbing = false;

  // ---------- overlays ----------
  function renderHead() {
    const iso = isoOfDay(tl, day);
    els.date.dateTime = iso; els.date.textContent = fmtDate(iso);
    const k = chapterAt(ep, day);
    els.chapter.textContent = `Chapter ${k + 1} of ${ep.chapters.length} · ${ep.chapters[k].title}`;
    const t = totalsAt(tl, day, { who });
    els.totals.textContent = who == null
      ? `${plural(t.commits, 'commit')} · ${plural(t.fixes, 'fix')} · ${plural(t.people, 'author')} so far`
      : `${tl.people[who].name}: ${plural(t.commits, 'commit')} · ${plural(t.fixes, 'fix')} so far`;
  }
  function renderPeople() {
    const act = activeAt(tl, day, { window: 14, who, limit: 12 });
    els.people.textContent = '';
    if (!act.length) { const li = document.createElement('li'); li.className = 'n'; li.textContent = 'Nobody committed in the last two weeks.'; els.people.append(li); return; }
    const max = act[0].commits;
    for (const a of act) {
      const li = document.createElement('li'); li.style.color = player.colorVarOf(a.name);
      const b = document.createElement('button'); b.type = 'button'; b.textContent = a.name; b.title = `Follow ${a.name}`;
      b.setAttribute('aria-label', `${a.name}: ${plural(a.commits, 'commit')}, ${plural(a.fixes, 'fix')} in two weeks. Follow ${a.name}.`);
      b.addEventListener('click', () => onFollow(a.name));
      const n = document.createElement('span'); n.className = 'n'; n.textContent = `${fmtN(a.commits)} · ${fmtN(a.fixes)} fix · ${fmtN(a.total)} total`;
      const bar = document.createElement('span'); bar.className = 'barline'; bar.setAttribute('aria-hidden', 'true');
      const i = document.createElement('i'); i.style.width = (a.commits / max * 100).toFixed(1) + '%';
      const f = document.createElement('b'); f.style.width = (a.fixes / max * 100).toFixed(1) + '%';
      bar.append(i, f);
      li.append(b, n, bar); els.people.append(li);
    }
  }
  function renderFeed() {
    const d = Math.floor(day);
    const [, to] = commitRange(tl, 0, d + 1);
    els.feed.textContent = '';
    let shown = 0;
    for (let i = to - 1; i >= 0 && shown < FEED_ROWS; i--) {
      const c = tl.commits[i];
      if (who != null && c[TL.who] !== who) continue;
      shown++;
      const fx = fixOf(tl, i);
      const li = document.createElement('li'); li.className = `k-${fx.kind}${c[TL.day] === d ? ' today' : ''}`;
      const t = document.createElement('time'); t.dateTime = fx.d; t.textContent = fmtShort(fx.d);
      const w = document.createElement('span'); w.className = 'who'; w.style.color = player.colorVarOf(fx.who); w.textContent = fx.who;
      if (fx.repo) { const r = document.createElement('span'); r.className = 'repo'; r.textContent = fx.repo; w.append(' ', r); }
      const s = document.createElement('span'); s.className = 's';
      const k = document.createElement('span'); k.className = 'k'; k.textContent = fx.kind === 'other' ? '' : fx.kind;
      s.append(k, fx.s);
      const url = (fx.issues.length || fx.pr) ? player.fixUrl(fx) : null;
      const meta = [];
      if (fx.files != null) meta.push(plural(fx.files, 'file'));
      if (fx.issues.length > 1) meta.push(`also ${fx.issues.slice(1).map((x) => '#' + x.number).join(', ')}`);
      w.append(' ');
      if (fx.issues.length || fx.pr) {
        const tag = player.fixTag(fx);
        if (url) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = tag; w.append(a); }
        else w.append(tag);
      }
      if (meta.length) { const m = document.createElement('span'); m.className = 'meta'; m.textContent = meta.join(' · '); w.append(m); }
      li.append(t, w, s); els.feed.append(li);
    }
    if (!shown) { const li = document.createElement('li'); li.textContent = 'No commits yet.'; els.feed.append(li); }
    const today = tl.commits.slice(commitRange(tl, d, d + 1)[0], to).filter((c) => who == null || c[TL.who] === who).length;
    els.feedNote.textContent = today ? `${plural(today, 'commit')} today · newest first` : 'newest first';
  }

  // ---------- timeline ----------
  function colors() {
    const cs = getComputedStyle(movie);
    const g = (n) => cs.getPropertyValue('--' + n).trim();
    return { ink: g('ink'), muted: g('muted'), rule: g('rule'), bug: g('bug'), gold: g('gold'), paper: g('paper'), paper2: g('paper-2'), grid: g('grid'), hl: g('hl'), hlInk: g('hl-ink') };
  }
  const BAND = 15, FOOT = 13;
  function drawLayer() {
    const cv = els.tl, w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!w || !tl) return;
    layer = document.createElement('canvas'); layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr);
    const c = layer.getContext('2d'); c.scale(dpr, dpr);
    const k = colors(), X = (dd) => dd / tl.days * w;
    c.font = '600 10px "Spline Sans Mono", ui-monospace, monospace'; c.textBaseline = 'middle';
    ep.chapters.forEach((ch, i) => {
      const x0 = X(dayOfIso(tl, ch.first)), x1 = i + 1 < ep.chapters.length ? X(dayOfIso(tl, ep.chapters[i + 1].first)) : w;
      c.fillStyle = i % 2 ? k.paper2 : k.paper; c.fillRect(x0, 0, x1 - x0, BAND);
      c.strokeStyle = k.rule; c.beginPath(); c.moveTo(x0 + .5, 0); c.lineTo(x0 + .5, h - FOOT); c.stroke();
      c.save(); c.beginPath(); c.rect(x0 + 3, 0, Math.max(0, x1 - x0 - 6), BAND); c.clip();
      c.fillStyle = k.ink; c.fillText(`${i + 1} ${ch.title}`, x0 + 4, BAND / 2 + 1); c.restore();
    });
    const top = BAND + 2, bot = h - FOOT, max = Math.max(1, ...buckets.map((b) => b.commits));
    const bw = Math.max(1, X(7) - (X(7) > 3 ? 1 : 0));
    for (const b of buckets) {
      const x = X(b.day), scale = (bot - top) / max;
      const hc = b.commits * scale, hf = b.fixes * scale, hn = b.feats * scale;
      c.fillStyle = k.muted; c.globalAlpha = .45; c.fillRect(x, bot - hc, bw, hc - hf - hn);
      c.globalAlpha = 1; c.fillStyle = k.gold; c.fillRect(x, bot - hf - hn, bw, hn);
      c.fillStyle = k.bug; c.fillRect(x, bot - hf, bw, hf);
    }
    c.strokeStyle = k.ink; c.lineWidth = 1; c.beginPath(); c.moveTo(0, bot + .5); c.lineTo(w, bot + .5); c.stroke();
    for (const r of tl.releases) {
      if (r.weight < 2) continue;
      const x = X(r.day) + .5;
      c.strokeStyle = k.ink; c.globalAlpha = r.weight >= 3 ? 1 : .55; c.beginPath(); c.moveTo(x, top); c.lineTo(x, bot); c.stroke();
      c.fillStyle = k.gold; c.beginPath(); c.moveTo(x, top); c.lineTo(x + 6, top + 3); c.lineTo(x, top + 6); c.closePath(); c.fill();
      c.globalAlpha = 1;
      if (r.weight >= 3) { c.fillStyle = k.ink; c.fillText(r.tag, x + 8, top + 4); }
    }
    // date ticks: years, or months for short histories
    c.fillStyle = k.muted; c.font = '10px "Spline Sans Mono", ui-monospace, monospace';
    const months = tl.days < 500;
    let lastX = -1e9;
    for (let d = 0; d < tl.days; d++) {
      const iso = isoOfDay(tl, d);
      if (!(months ? iso.endsWith('-01') : iso.endsWith('-01-01')) && d !== 0) continue;
      const x = X(d);
      const label = months ? `${MON[+iso.slice(5, 7) - 1]}${iso.slice(5, 7) === '01' || d === 0 ? ' ' + iso.slice(0, 4) : ''}` : iso.slice(0, 4);
      if (x - lastX < c.measureText(label).width + 10) continue;
      c.fillRect(x, bot, 1, 4); c.fillText(label, x + 3, h - FOOT / 2 + 1); lastX = x;
    }
  }
  function drawTimeline() {
    const cv = els.tl, w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!w || !tl) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr) || !layer) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); drawLayer(); }
    const c = cv.getContext('2d'), k = colors();
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
    if (layer) c.drawImage(layer, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = day / tl.days * w;
    c.fillStyle = k.paper2; c.globalAlpha = .55; c.fillRect(x, BAND + 2, w - x, h - FOOT - BAND - 2); c.globalAlpha = 1;
    c.fillStyle = k.ink; c.fillRect(Math.round(x) - 1, 0, 2, h - FOOT + 3);
    c.beginPath(); c.moveTo(x - 6, 0); c.lineTo(x + 6, 0); c.lineTo(x, 7); c.closePath(); c.fill();
  }

  // ---------- scrubbing ----------
  const seekFromInput = () => { player.seek(Number(els.scrub.value)); };
  els.scrub.addEventListener('input', () => { scrubbing = true; seekFromInput(); });
  els.scrub.addEventListener('change', () => { scrubbing = false; });
  els.scrub.addEventListener('pointerup', () => { scrubbing = false; });

  // ---------- overlay insets: tell the player what the side panels cover ----------
  function updateInsets() {
    const sw = screen.clientWidth;
    if (sw < 700) { player.setInsets(0, 0); return; }
    const sr = screen.getBoundingClientRect();
    const pv = !movie.classList.contains('no-people'), fv = !movie.classList.contains('no-feed');
    const l = pv ? els.peopleBox.getBoundingClientRect().right - sr.left : 0;
    const r = fv ? sr.right - els.feedBox.getBoundingClientRect().left : 0;
    player.setInsets(l + 6, r + 6);
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { layer = null; drawTimeline(); updateInsets(); }) : null;
  ro && ro.observe(movie);

  return {
    setEpisode(episode) {
      ep = episode; tl = ep.timeline; who = null; lastDay = -1; layer = null;
      buckets = weekBuckets(tl);
      els.scrub.max = String(tl.days - 1);
      els.scrub.value = '0';
      this.onTime({ day: 0 });
      updateInsets();
    },
    /** Following one person (index into timeline.people) or everyone (null). */
    setFollow(name) {
      if (!tl) return;
      const i = name == null ? -1 : tl.people.findIndex((p) => p.name === name);
      who = i < 0 ? null : i;
      buckets = weekBuckets(tl, { who }); layer = null; lastDay = -1;
      this.onTime({ day });
    },
    onTime(t) {
      if (!tl) return;
      day = t.day;
      renderHead();
      if (Math.floor(day) !== lastDay) { lastDay = Math.floor(day); renderPeople(); renderFeed(); }
      if (!scrubbing) { els.scrub.value = String(Math.floor(day)); }
      els.scrub.setAttribute('aria-valuetext', fmtDate(isoOfDay(tl, day)));
      drawTimeline();
    },
    redraw() { layer = null; drawTimeline(); updateInsets(); },
    updateInsets,
  };
}
