// A small dependency-free check that an object is a playable episode.
// Mirrors the required parts of episode.schema.json.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = new Set(['gremlin', 'beetle', 'crawler', 'wraith', 'moth', 'bomb']);

/**
 * @param {any} ep
 * @returns {string[]} Problems found; empty means the player can run it.
 */
export function validateEpisode(ep) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); return cond; };
  if (!need(ep && typeof ep === 'object', 'Episode is not an object.')) return errs;
  if (ep.schemaVersion === 1) return ['This episode was made by an older version of Commit Wars and has no timeline. Rebuild it from its repository or git log.'];
  need(ep.schemaVersion === 2, `Unsupported schemaVersion ${JSON.stringify(ep.schemaVersion)} (this player reads version 2).`);
  const s = ep.summary;
  if (need(s && typeof s === 'object', 'summary is missing.')) {
    need(typeof s.repo === 'string', 'summary.repo must be a string.');
    need(Number.isInteger(s.commits), 'summary.commits must be an integer.');
    need(s.first && DATE.test(s.first.d), 'summary.first.d must be a YYYY-MM-DD date.');
    need(s.latest && DATE.test(s.latest.d), 'summary.latest.d must be a YYYY-MM-DD date.');
  }
  const fix = (f, where) => {
    if (!need(f && typeof f === 'object', `${where} is not an object.`)) return;
    need(typeof f.sha === 'string', `${where}.sha must be a string.`);
    need(typeof f.t === 'string' && typeof f.s === 'string', `${where} needs t and s strings.`);
    need(DATE.test(f.d), `${where}.d must be a YYYY-MM-DD date.`);
    need(TYPES.has(f.type), `${where}.type "${f.type}" is not an enemy type.`);
  };
  if (need(Array.isArray(ep.chapters) && ep.chapters.length > 0, 'chapters must be a non-empty array.')) {
    ep.chapters.forEach((ch, i) => {
      const w = `chapters[${i}]`;
      need(typeof ch.title === 'string', `${w}.title must be a string.`);
      need(DATE.test(ch.first) && DATE.test(ch.last), `${w} needs first and last dates.`);
      need(Array.isArray(ch.powerups), `${w}.powerups must be an array.`);
      if (need(Array.isArray(ch.heroes) && ch.heroes.length > 0, `${w}.heroes must be a non-empty array.`)) {
        ch.heroes.forEach((h, j) => {
          need(typeof h.name === 'string', `${w}.heroes[${j}].name must be a string.`);
          if (h.duel) fix(h.duel, `${w}.heroes[${j}].duel`);
          need(Array.isArray(h.mob), `${w}.heroes[${j}].mob must be an array.`);
          (h.mob || []).forEach((m, k) => fix(m, `${w}.heroes[${j}].mob[${k}]`));
        });
      }
    });
  }
  if (need(Array.isArray(ep.roster), 'roster must be an array.')) {
    ep.roster.forEach((r, i) => {
      need(typeof r.name === 'string', `roster[${i}].name must be a string.`);
      need(Array.isArray(r.gauntlet), `roster[${i}].gauntlet must be an array.`);
      (r.gauntlet || []).forEach((g, k) => fix(g, `roster[${i}].gauntlet[${k}]`));
    });
  }
  const tl = ep.timeline;
  if (need(tl && typeof tl === 'object', 'timeline is missing.')) {
    need(DATE.test(tl.start) && DATE.test(tl.end), 'timeline needs start and end dates.');
    need(Number.isInteger(tl.days) && tl.days > 0, 'timeline.days must be a positive integer.');
    need(Array.isArray(tl.releases), 'timeline.releases must be an array.');
    if (need(Array.isArray(tl.people) && tl.people.length > 0, 'timeline.people must be a non-empty array.')
      && need(Array.isArray(tl.commits), 'timeline.commits must be an array.')) {
      let prev = 0;
      for (let i = 0; i < tl.commits.length; i++) {
        const c = tl.commits[i];
        if (!need(Array.isArray(c) && c.length === (tl.repos ? 10 : 9), `timeline.commits[${i}] must be a ${tl.repos ? 10 : 9}-item array.`)) break;
        if (tl.repos && !need(Number.isInteger(c[9]) && c[9] >= 0 && c[9] < tl.repos.length, `timeline.commits[${i}] names an unknown repo.`)) break;
        if (!need(Number.isInteger(c[0]) && c[0] >= prev && c[0] < tl.days, `timeline.commits[${i}] has a day out of order or range.`)) break;
        if (!need(Number.isInteger(c[1]) && c[1] >= 0 && c[1] < tl.people.length, `timeline.commits[${i}] names an unknown person.`)) break;
        if (c[2] === 'fix' && !need(TYPES.has(c[4]), `timeline.commits[${i}].type "${c[4]}" is not an enemy type.`)) break;
        prev = c[0];
      }
    }
  }
  return errs.slice(0, 20);
}
