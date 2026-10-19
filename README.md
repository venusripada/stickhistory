# Commit Wars

Keep a library of repositories and watch each one's history as a stick-figure fight. Every hero is someone who wrote the commits. Every enemy is a bug or issue they actually fixed, labeled with its issue or pull request and sized by how many files the fix touched. The history plays as a movie you can scrub: every fix enters on the day it landed, each chapter's biggest fixes become duels, and Tech Debt arrives with the era's largest refactor.

```
npm install
npm run dev          # library server + web app on http://127.0.0.1:5173
```

Open the app, create a collection, paste a repository link (or a folder path on this machine) and press **Add story**. The server clones the history and builds the story; press **Play** when it's ready. The bundled opencode sample plays even without the server.

## No AI touches your repositories

- The pipeline is plain `git` plus deterministic code: no model calls, and no network traffic besides the `git clone` and `git fetch` you ask for.
- Clones are blobless (`--filter=blob:none`), so source files are never downloaded; only commits, changed paths and tags are.
- The library server listens on 127.0.0.1 only.

## What's in here

```
packages/
  story-engine/     History → Episode. Pure, deterministic, runs in the browser and Node.
  git-source/       Node only: clone, fetch and read a repo's history with the git command line.
  github-fetcher/   GitHub link → History via the GitHub API (used by the CLI's github command).
  player/           Episode → movie on a <canvas>. Emits events for the page around it.
apps/
  server/           Local library server: collections and stories as folders, build jobs, API.
  web/              The library and movie app (Vite, no framework).
  cli/              commit-wars github|git|rebuild → episode.json
e2e/                Browser test of the built app against the real server and generated repos.
examples/           Author alias file used for the opencode sample.
scripts/dev.mjs     Runs the server and the Vite dev server together.
```

The two data shapes between the pieces are the contract:

- **History** (`historyVersion: 1`): commits with author, date, subject, file count, the pull request they landed through, that PR's labels and the issues it closes, plus tags. Documented in `packages/story-engine/src/types.js`. Anything that can produce it can feed the engine (a local clone, GitHub, GitLab later).
- **Episode** (`schemaVersion: 2`): chapters (titles, duels, power-ups, reverts, bosses, releases), the roster, and a `timeline` holding every commit as a compact tuple plus every release tag. JSON Schema in `packages/story-engine/src/episode.schema.json`; `validateEpisode()` checks the parts the player needs. Version 1 files are refused with a message to rebuild them. `timeline.js` exports the helpers that read the timeline (`totalsAt`, `activeAt`, `weekBuckets`, `commitRange`, …), so the player and the page compute every number the same way.

## The library

Collections and stories are folders, and the folders are the whole database:

```
library/                         ($COMMIT_WARS_LIBRARY overrides; git-ignored)
  open-source-ai/                a collection
    collection.json              name, description, story order
    opencode/                    a story
      story.json                 repo URL, branch, aliases, titles, status, last fetch and build
      repo.git/                  bare, blobless clone
      history.json               the history read from the clone
      episode.json               what the player plays
```

- **Add a story:** paste any link this machine's `git` can clone (https, ssh, GitHub or not) or a local folder path. Private repos work when `git clone` works for them here; the app asks for no tokens.
- **Update** (per story, or **Update all** per collection) fetches and rebuilds only when there are new commits. Opening a story that hasn't been fetched for a day checks in the background and offers the newer version.
- **Rename**, **Move** and **Delete** change the folders. Folders changed by hand show up on the next refresh.
- Progress streams to the page live while a story clones and builds.

## How a repository becomes a fight

1. **Read** (`readHistory` in git-source). `git log` with the format in `GIT_LOG_FORMAT` gives each commit's author, date, subject, body and changed paths. Issue links come from GitHub's closing keywords in the subject or body ("Fixes #123").
2. **Build** (`buildEpisode`).
   - Authors are merged into people (shared email, noreply email, exact full name, or a hand-written alias map). Bots are set aside; they become the release bot.
   - Commits are classified as fix, feature, refactor or revert from conventional-commit prefixes, keywords and labels.
   - Chapters start as equal slices (3 to 9, growing with history size) and snap to nearby release tags, so they tend to end on real releases.
   - Each hero's duel is their highest-scoring fix of the chapter. Fixes that closed an issue score highest, then size, a linked PR, a scope and bug words; chores like dependency bumps, docs and translations are pushed down.
   - Enemy type comes from labels first, then words in the subject, then the code area: Crash Bomb, Perf Beetle, Path Wraith, Glitch Moth, Gremlin (terminal UI), Logic Crawler.
3. **Play** (`createPlayer`). The episode plays as a movie, and every calendar day gets the same screen time: the whole history takes about ten minutes at 1×, with speeds from 0.5× to 8×.
   - **Fights:** every fix enters on the day it landed and is fought by its author. The six busiest people of the last two weeks are on stage. Fixes that don't fit wait at the edge as a "+N" swarm.
   - **Story beats:** each chapter's biggest fixes are spotlight duels, Tech Debt arrives on the date of the era's largest refactor, and minor and major releases plant a flag and set off fireworks.
   - **Seeking:** `seek(day)` jumps anywhere.
   - **Events:** the player emits `time`, `state` and `spotlight`.

## The movie

- **The fight fills the frame.**
  - **Overlays:** the date and running totals; **People** (who was active in the last 14 days, with commit and fix counts; click a name to follow them); **Feed** (every commit up to the playhead, newest first, linked to its issue or pull request).
  - **Timeline:** under the frame, with commits per week (fixes red, features gold), chapter spans and release marks. Drag it to scrub.
  - **Full screen:** the ⛶ button, or press F.
  - **Keys:** Space plays or pauses, ←/→ move a week, Shift+←/→ jump chapters, P and L toggle the panels.
- **Follow a hero** (the cards under the movie, or a name in the People panel) plays only that person's fixes and features.
- `#/s/collection/story` links open a story; `?embed=1` shows only the movie, autoplays and loops. **Copy embed code** gives an `<iframe>`.
- **Download episode** / **Open episode file** move episodes between machines.
- Without the server, a `git log` file can still be replayed: run the command shown on the page inside a repository and open the file. It plays without being saved.

## Running it

```
npm run dev          # server on 127.0.0.1:5174 + Vite on 127.0.0.1:5173 (proxies /api)
npm run serve        # build, then serve the app and the API together on 127.0.0.1:5173
npm run server       # the library server alone (--port, --library, --static)
```

## Command line

```
npm run cli -- git ../some-clone --aliases examples/opencode.aliases.json -o episode.json
npm run cli -- github anomalyco/opencode -o opencode.json --token $GITHUB_TOKEN
npm run cli -- rebuild history.json -o episode.json
```

`--history-out` saves the raw history so the story can be rebuilt (new engine version, different chapter count, custom `--titles`) without refetching. The `github` command uses the GitHub API and reads `GITHUB_TOKEN` or `GH_TOKEN`. The opencode sample was made with:

```
npm run cli -- git /path/to/opencode --name anomalyco/opencode \
  --url https://github.com/anomalyco/opencode \
  --aliases examples/opencode.aliases.json -o apps/web/public/samples/opencode.json
```

## Using the packages directly

```js
import { cloneRepo, readHistory, checkGitUrl } from '@commit-wars/git-source';   // Node only
import { buildEpisode } from '@commit-wars/story-engine';
import { createPlayer } from '@commit-wars/player';

await cloneRepo(checkGitUrl('https://github.com/owner/repo').url, 'repo.git');
const history = await readHistory('repo.git', { name: 'repo' });
const episode = buildEpisode(history, { aliases: { Ada: ['Ada Lovelace', 'ada@old-mail.com'] } });
const player = createPlayer({ canvas: document.querySelector('canvas'), episode, loop: true });
player.on('time', ({ iso }) => console.log(iso));
player.seek(120);        // day 120 of the history
player.follow('ada');
```

The player reads its colors from CSS custom properties on the canvas (`--paper`, `--ink`, `--bug`, `--orb`, `--c1` … `--c11`, see `DEFAULT_THEME`), so it follows the host page's light and dark themes.

## Tests

```
npm test                       # engine, fetcher, git-source, player director and server tests (82)
npm run build && npm run e2e   # full app in Chromium against the real server (34 checks, screenshots in e2e/output/)
```

Tests make their own repositories in the system temp folder with made-up people and messages, and never touch the real library or the network. The e2e also replays the real public `git log` of sindresorhus/ky (`e2e/fixtures/ky-git-log.txt`).

## Limits right now

- Issue links depend on closing keywords ("Fixes #123") in commit messages. Repos that only link issues from pull request descriptions get commit-based enemies instead.
- Issue titles aren't known from git alone, so issue-linked duels are titled by the commit.
- Chapter titles are generated from releases and fix scopes ("Road to v1.0.0", "The TUI Gremlins"). Use `--titles` (CLI) or a story's `titles` for hand-written ones.
- The library is single-user and local by design.

## Next

- Video and GIF export of a replay.
- A GitHub Action that rebuilds the episode on every release.
- More history sources (GitLab, Bitbucket) without changing the engine or player.
