// Client for the local library server (apps/server). Errors come back as
// ApiError with the server's plain-language message.

export class ApiError extends Error {
  constructor(status, message) { super(message); this.name = 'ApiError'; this.status = status; }
}

export const OFFLINE_MESSAGE = 'The library server isn\'t running. Start it with `npm run dev` (or `npm run serve` for the built app), then reload this page.';

async function call(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError(0, OFFLINE_MESSAGE); }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    if (!json && (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 404)) throw new ApiError(0, OFFLINE_MESSAGE);
    throw new ApiError(res.status, (json && json.error) || `The library server answered ${res.status}.`);
  }
  return json;
}

const enc = encodeURIComponent;
const story = (c, s) => `/collections/${enc(c)}/stories/${enc(s)}`;
const episodes = new Map(); // "c/s" -> { etag, episode }

export const api = {
  library: () => call('GET', '/library'),
  createCollection: (name, description) => call('POST', '/collections', { name, description }),
  updateCollection: (c, patch) => call('PATCH', `/collections/${enc(c)}`, patch),
  deleteCollection: (c, confirm) => call('DELETE', `/collections/${enc(c)}${confirm ? `?confirm=${enc(confirm)}` : ''}`),
  updateCollectionStories: (c) => call('POST', `/collections/${enc(c)}/update`, {}),
  addStory: (c, { url, name, branch }) => call('POST', `/collections/${enc(c)}/stories`, { url, name: name || undefined, branch: branch || undefined }),
  editStory: (c, s, patch) => call('PATCH', story(c, s), patch),
  deleteStory: (c, s) => call('DELETE', `${story(c, s)}?confirm=${enc(s)}`),
  updateStory: (c, s) => call('POST', `${story(c, s)}/update`, {}),
  people: (c, body) => call('POST', `/collections/${enc(c)}/people`, body),
  orgRepos: (owner, c) => call('GET', `/orgs/${enc(owner)}/repos${c ? `?collection=${enc(c)}` : ''}`),
  addStories: (c, repos) => call('POST', `/collections/${enc(c)}/stories/batch`, { repos }),
  /** A collection's combined movie (all its stories), cached like a story's. */
  collectionEpisode: (c) => fetchEpisode(`/collections/${enc(c)}/episode`),
  /** Periods: a collection's movie and report for a quarter or any dates. */
  createPeriod: (c, from, to) => call('POST', `/collections/${enc(c)}/periods`, { from, to }),
  rebuildPeriod: (c, id) => call('POST', `/collections/${enc(c)}/periods/${enc(id)}/rebuild`, {}),
  deletePeriod: (c, id) => call('DELETE', `/collections/${enc(c)}/periods/${enc(id)}`),
  periodEpisode: (c, id) => fetchEpisode(`/collections/${enc(c)}/periods/${enc(id)}/episode`),
  periodReport: (c, id) => fetchEpisode(`/collections/${enc(c)}/periods/${enc(id)}/report`),
  /** The one-file download (movie and report) for sharing. */
  periodShareUrl: (c, id) => `/api/collections/${enc(c)}/periods/${enc(id)}/share`,
  /** The built episode, reusing the last copy when the server says it hasn't changed. */
  episode: (c, s) => fetchEpisode(story(c, s) + '/episode'),
};

async function fetchEpisode(path) {
  const key = path, have = episodes.get(key);
  let res;
  try { res = await fetch('/api' + path, { headers: have ? { 'if-none-match': have.etag } : {} }); }
  catch { throw new ApiError(0, OFFLINE_MESSAGE); }
  if (res.status === 304 && have) return have.episode;
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, (json && json.error) || OFFLINE_MESSAGE);
  episodes.set(key, { etag: res.headers.get('etag'), episode: json });
  return json;
}

/** Live job progress and library changes. Returns a function that stops listening. */
export function subscribe({ onJob, onLibrary, onOpen, onDown }) {
  if (typeof EventSource !== 'function') return () => {};
  const es = new EventSource('/api/events');
  es.addEventListener('job', (e) => { try { onJob && onJob(JSON.parse(e.data)); } catch { /* bad event */ } });
  es.addEventListener('library', () => onLibrary && onLibrary());
  es.addEventListener('hello', () => onOpen && onOpen());
  es.onerror = () => onDown && onDown();
  return () => es.close();
}
