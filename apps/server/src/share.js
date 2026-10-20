// A period as one .html file anyone can open: the built web app with its
// script and styles inlined and the period's movie and report inside it.
// No server, no install; fonts load from Google Fonts when online.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** JSON that is safe inside a <script> element. */
const scriptJson = (v) => JSON.stringify(v).replace(/[<\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * @param {string} staticDir  The built web app (apps/web/dist).
 * @param {{ episode: any|null, report: any, title: string, madeAt?: string }} data
 * @returns {string|null}  null when the web app hasn't been built
 */
export function shareHtml(staticDir, data) {
  const index = staticDir && join(staticDir, 'index.html');
  if (!index || !existsSync(index)) return null;
  let html = readFileSync(index, 'utf8');
  const asset = (rel) => readFileSync(join(staticDir, rel.replace(/^\.\//, '')), 'utf8');
  html = html.replace(/<link rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+\.css)"[^>]*>/g, (m, href) => `<style>${asset(href)}</style>`);
  const payload = `<script>window.__CW_SHARE__=${scriptJson(data)};</script>`;
  html = html.replace(/<script type="module"[^>]*src="(\.\/assets\/[^"]+\.js)"[^>]*><\/script>/g, (m, src) => `${payload}<script type="module">${asset(src).replace(/<\/script/gi, '<\\/script')}</script>`);
  return html.replace(/<title>[^<]*<\/title>/, `<title>${data.title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))} · Commit Wars</title>`);
}
