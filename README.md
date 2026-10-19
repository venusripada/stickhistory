# Commit Wars

Paste a GitHub link and watch the repository's history as a stick-figure fight. Every hero is someone who wrote the commits; every enemy is a bug or issue they actually fixed, labeled with its issue or pull request and sized by how many files the fix touched. Each chapter opens with one-on-one duels, then a brawl, then a boss fight against Tech Debt finished by that era's biggest refactor.

```
npm install
npm run dev          # http://localhost:5173
```

Open the app, paste `github.com/owner/repo`, press **Build the fight**. The bundled opencode sample plays on the home page so there is always something running.

## What's in here

```
packages/
  story-engine/     History → Episode. Pure, deterministic, runs in the browser and Node.
  github-fetcher/   GitHub link → History, via GraphQL (with a token) or REST (without).
  player/           Episode → animation on a <canvas>. Emits events for the page around it.
apps/
  web/              The paste-a-link app (Vite, no framework).
  cli/              commit-wars github|git|rebuild → episode.json
e2e/                Browser test of the built app with GitHub mocked from real opencode data.
examples/           Author alias file used for the opencode sample.
```

The two data shapes between the pieces are the contract:

- **History** (`historyVersion: 1`): commits with author, date, subject, file count, the pull request they landed through, that PR's labels and the issues it closes, plus tags. Documented in `packages/story-engine/src/types.js`. Anything that can produce it can feed the engine (GitHub, a local clone, GitLab later).
- **Episode** (`schemaVersion: 2`): chapters (titles, duels, power-ups, reverts, bosses, releases), the roster, and a `timeline` holding every commit as a compact tuple plus every release tag. JSON Schema in `packages/story-engine/src/episode.schema.json`; `validateEpisode()` checks the parts the player needs. Version 1 files are refused with a message to rebuild them. `timeline.js` exports the helpers that read the timeline (`totalsAt`, `activeAt`, `weekBuckets`, `commitRange`, …), so the player and the page compute every number the same way.

## How a link becomes a fight

1. **Fetch** (`fetchHistory`). With a token, one GraphQL request per 100 commits returns each commit's GitHub login, avatar, file count, pull request, labels and closing issues; pages that time out are retried at a smaller size. Without a token it uses the REST API (60 requests an hour), which gets authors, dates and subjects but no file counts or issue links. Rate limits, missing repos, bad tokens and cancellation all come back as readable errors.
2. **Build** (`buildEpisode`).
   - Authors are merged into people (GitHub login, shared email, noreply email, or a hand-written alias file) and bots are set aside; they become the release bot.
   - Commits are classified as fix, feature, refactor or revert from conventional-commit prefixes, keywords and PR or issue labels.
   - Chapters start as equal slices (3 to 9, growing with history size) and snap to nearby release tags, so they tend to end on real releases.
   - Each hero's duel is their highest-scoring fix of the chapter. Fixes that closed an issue score highest, then size, a linked PR, a scope and bug words; chores like dependency bumps, docs and translations are pushed down. A duel that closed an issue is titled by the issue.
   - Enemy type comes from labels first, then words in the subject, then the code area: Crash Bomb, Perf Beetle, Path Wraith, Glitch Moth, Gremlin (terminal UI), Logic Crawler.
3. **Play** (`createPlayer`). The episode plays as a movie, and every calendar day gets the same screen time: the whole history takes about ten minutes at 1×, with speeds from 0.5× to 8×.
   - **Fights:** every fix enters on the day it landed and is fought by its author. The six busiest people of the last two weeks are on stage. Fixes that don't fit wait at the edge as a "+N" swarm.
   - **Story beats:** each chapter's biggest fixes are spotlight duels, Tech Debt arrives on the date of the era's largest refactor, and minor and major releases plant a flag and set off fireworks.
   - **Seeking:** `seek(day)` jumps anywhere.
   - **Events:** the player emits `time`, `state` and `spotlight`.

## The web app

- `#/r/owner/repo` builds (or loads from cache) and plays a repo; `#/r/owner/repo/tree/branch` picks a branch. These links are shareable.
- **The movie:** the fight fills the frame.
  - **Overlays:** the date and running totals; **People** (who was active in the last 14 days, with commit and fix counts; click a name to follow them); **Feed** (every commit up to the playhead, newest first, linked to its issue or pull request).
  - **Timeline:** under the frame, with commits per week (fixes red, features gold), chapter spans and release marks. Drag it to scrub.
  - **Full screen:** the ⛶ button, or press F.
  - **Keys:** Space plays or pauses, ←/→ move a week, Shift+←/→ jump chapters, P and L toggle the panels.
- **Follow a hero** (the cards under the movie, or a name in the People panel) plays only that person's fixes and features.
- `?embed=1` shows only the movie, autoplays and loops. **Copy embed code** gives an `<iframe>` for READMEs, docs or dashboards.
- Built episodes are cached in the browser's IndexedDB (last 8 repos). **Rebuild** refetches.
- **Download episode** / **Open episode file** move episodes between people and machines.
- The token field is optional. The token stays in the browser (session only, unless "Remember on this device" is ticked) and is only sent to api.github.com. A fine-grained token with read-only access to public repositories is enough; add private repos to it to replay those.
- Local or private repos can also be replayed without any token: run the `git log` command shown on the page and open the file. The command includes commit bodies, so "Fixes #123" in a message links the fix to its issue (the issue's title isn't known offline, so the duel is titled by the commit).

Build for any static host with `npm run build`; the `apps/web/dist` folder works from a sub-path because asset paths are relative.

## Command line

```
npm run cli -- github anomalyco/opencode -o opencode.json --token $GITHUB_TOKEN
npm run cli -- git ../some-clone --aliases examples/opencode.aliases.json -o episode.json
npm run cli -- rebuild history.json -o episode.json
```

`--history-out` saves the raw history so the story can be rebuilt (new engine version, different chapter count, custom `--titles`) without refetching. `GITHUB_TOKEN` or `GH_TOKEN` are read from the environment. The opencode sample was made with:

```
npm run cli -- git /path/to/opencode --name anomalyco/opencode \
  --url https://github.com/anomalyco/opencode \
  --aliases examples/opencode.aliases.json -o apps/web/public/samples/opencode.json
```

## Using the packages directly

```js
import { fetchHistory } from '@commit-wars/github-fetcher';
import { buildEpisode } from '@commit-wars/story-engine';
import { createPlayer } from '@commit-wars/player';

const history = await fetchHistory({ url: 'github.com/owner/repo', token, onProgress: (p) => console.log(p.message) });
const episode = buildEpisode(history, { aliases: { Ada: ['Ada Lovelace', 'ada@old-mail.com'] } });
const player = createPlayer({ canvas: document.querySelector('canvas'), episode, loop: true });
player.on('time', ({ iso }) => console.log(iso));
player.on('spotlight', (beat) => console.log(beat.kind));
player.seek(120);        // day 120 of the history
player.follow('ada');
```

The player reads its colors from CSS custom properties on the canvas (`--paper`, `--ink`, `--bug`, `--orb`, `--c1` … `--c11`, see `DEFAULT_THEME`), so it follows the host page's light and dark themes.

## Tests

```
npm test             # story engine, fetcher and player director unit tests (64)
npm run build && npm run e2e   # full app in Chromium, GitHub mocked (30 checks, screenshots in e2e/output/)
```

The end-to-end fixtures are the newest 1,200 real opencode commits shaped like GraphQL responses (its issue titles are test fixtures, not real issue titles) and the real `git log` of sindresorhus/ky in the format the page shows.

## Limits right now

- The browser calls GitHub directly, so a big history takes a while: about 1 to 3 seconds per 100 commits with a token. The default is the newest 2,000 commits; "everything" works but is slow for repos with tens of thousands of commits.
- Without a token there are no file counts or linked issues, and the hourly limit allows roughly two builds.
- Issue links depend on GitHub's closing keywords ("Fixes #123"): in the pull request when fetching from GitHub, in the commit message when reading a `git log`. Fixes without one get commit-based enemies instead.
- Chapter titles are generated from releases and fix scopes ("Road to v1.0.0", "The TUI Gremlins"). Use `--titles` for hand-written ones.

## Next (Phase 2 and 3 of the plan)

- A small backend: GitHub App auth (higher limits, private repos without pasting tokens), a job queue for large repos with incremental updates, and server-side caching so `/r/owner/repo` is instant for everyone.
- Video and GIF export of a replay.
- Optional AI-written chapter titles and one-line summaries from PR descriptions.
- A GitHub Action that rebuilds the episode on every release and commits it to the repo for the README embed.
