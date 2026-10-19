# Commit Wars: notes for Claude Code

Commit Wars turns a GitHub repository's history into a stick-figure fight. Heroes are the people who wrote the commits; enemies are the bugs and issues they actually fixed. A user pastes a GitHub link, the app fetches the history, builds a story ("episode") and plays it on a canvas.

Read this file, then `README.md`, then `docs/ROADMAP.md` before changing anything.

## Repo data never goes through AI

The owner's rule: the repositories in the library are not processed by any AI.
- The app has no model calls. History is read with plain `git`, and the story engine is deterministic code. Don't add an AI step (roadmap task 16 is excluded unless the owner approves it).
- Clones are blobless (`--filter=blob:none`), so source files are never downloaded; only commit metadata and changed paths are.
- **For Claude working in this repo:**
  - Never read, list, grep, cat or print anything under `library/` (or under `COMMIT_WARS_LIBRARY`).
  - Never open screenshots, logs or API responses taken against the real library.
  - Tests and e2e use repos generated inside the test with made-up authors and messages.
  - `.claude/settings.json` denies file reads and edits under `library/`. Shell commands are covered by this rule, not by the settings.

## Commands

```
npm install                 # npm workspaces; Node 18.17+
npm run dev                 # web app on http://localhost:5173
npm test                    # vitest: story-engine, github-fetcher, player director (64 tests)
npm run build               # apps/web/dist
npm run e2e                 # needs a build first; Chromium + mocked GitHub, 30 checks, screenshots in e2e/output/
npm run cli -- --help       # commit-wars github|git|rebuild
```

Before calling any task done: `npm test`, `npm run build`, `npm run e2e` all pass, and you have looked at the e2e screenshots for anything you changed on screen.

## Layout and the data flow

```
GitHub link ──fetchHistory()──▶ History ──buildEpisode()──▶ Episode ──createPlayer()──▶ canvas + events
             packages/github-fetcher     packages/story-engine          packages/player       apps/web builds the page UI from the events
```

- `packages/story-engine`: pure functions, no DOM, no network, no randomness. Same history + options → same episode (except `generatedAt`). Runs in the browser and in Node.
  - `classify.js`: commit kind (fix, feat, refactor, revert), enemy type, area, title cleanup, duel scoring (`fixScore`).
  - `identity.js`: merges author aliases into people, detects bots, picks display names.
  - `chapters.js`: chapter count and release-snapped boundaries.
  - `git-log.js`: parses `git log` output (including bodies) into a History; `closingIssues()` finds "Fixes #12" references.
  - `index.js`: `buildEpisode()`.
  - `validate.js`: `validateEpisode()`.
  - `types.js`: JSDoc for History and Fix.
  - `episode.schema.json`: the Episode contract.
- `packages/github-fetcher`: `fetchHistory()` uses GraphQL with a token (commits + PR + labels + closing issues + file counts + tags) and REST without one (60 requests an hour, no files or issues). `http.js` holds retries, rate limits and readable errors. Errors are `GitHubError` with a `code` (`not-found`, `rate-limit`, `bad-token`, `network`, …).
- `packages/player`: a movie player for an episode. Every calendar day gets the same screen time, and `seek(day)` jumps anywhere. It touches no DOM except its canvas.
  - `player.js`: the clock, seeking, follow mode and the API. It emits `time`, `state`, `spotlight` and `loaded`.
  - `director.js`: turns an episode into one sorted list of stage events (fix, duel, feat, revert, boss, release, chapter). Pure and unit-tested.
  - `sim.js`: hero, enemy, boss, orb and bolt physics.
  - `draw.js`: all canvas drawing.
  - `poses.js`, `theme.js`, `util.js`.
  - Shared state lives in one object `E` (`E.G` holds the stage). Colors come from CSS custom properties (`DEFAULT_THEME` lists them).
  - The stage is decoration. Every number on screen comes from the engine's `timeline.js` helpers, so a seek never has to replay anything.
- `apps/web`: Vite, plain JS, no framework. `main.js` holds routing (`#/r/owner/repo`, `#/sample/name`, `?embed=1`), the build flow, token handling, controls and keys. `movie-ui.js` draws the overlays (date, people, feed) and the timeline. `store.js` wraps localStorage for settings and IndexedDB for the episode cache.
- `apps/cli`: `bin/commit-wars.js`.
- `e2e/app.e2e.mjs`: serves `apps/web/dist`, mocks `api.github.com` from `e2e/fixtures/opencode-graphql.json` (1,200 real opencode commits in GraphQL shape; its issue titles are invented test fixtures), and opens `e2e/fixtures/ky-git-log.txt` (real ky `git log` in `GIT_LOG_FORMAT`) as a local history.

## Contracts: change them on purpose

- **History** (`historyVersion: 1`) and **Episode** (`schemaVersion: 2`) are the boundaries between packages. When you change the Episode shape:
  - Update `episode.schema.json`, `validate.js` and `types.js` together.
  - Keep the player able to read the current version, or bump `schemaVersion` and handle the old one (version 1 is refused with a message to rebuild).
  - Regenerate the sample (command below).
- A Fix record is `{ sha, pr, issues[], t, s, sc, d, files, area, type }`. `files` and `pr` can be null (REST mode), and an issue's `title` is null when it came from a `git log` reference. The player must never print "null" or "0 files" for unknown values.
- Enemy types are exactly `gremlin | beetle | crawler | wraith | moth | bomb`. Adding one means touching `classify.js`, the schema, `validate.js`, the player's `ETYPES` and its `drawEnemy`, and the legend in `apps/web/src/main.js`.

## Conventions

- ES modules, plain JavaScript with JSDoc. No TypeScript build step unless the roadmap task says so.
- No new runtime dependencies in `packages/*` without a strong reason. The packages are meant to stay small and portable.
- User-facing text:
  - Write it from the user's side: say what happened and what to do next.
  - Errors are complete sentences with a fix ("…isn't found. If it's private, add a GitHub token that can read it.").
  - No apologies, no exclamation marks outside the fight itself.
- Tests:
  - Engine and fetcher changes get vitest tests.
  - Fetcher tests inject `fetch`; never call the real GitHub API in tests.
  - UI flows get a check in `e2e/app.e2e.mjs`.
- Keep the web app working at 390px wide with no horizontal scroll, in light and dark themes, and under `prefers-reduced-motion` (the player starts paused).
- Tokens: never log them, never put them in URLs, only send them to `api.github.com` (or the configured API URL).

## Known gaps and gotchas

- **The live GitHub fetch has never run against the real API.** It was built and tested only against mocked responses. The owner prefers testing against local clones for now; the live check is deferred (`docs/ROADMAP.md`, task 1b). Specific worries:
  - GraphQL cost and timeouts from `associatedPullRequests` + `closingIssuesReferences` + `changedFilesIfAvailable` on 100-commit pages.
  - Browsers only see rate-limit headers that GitHub exposes over CORS.
  - `changedFilesIfAvailable` returning null on big commits.
- Big histories are slow in the browser (roughly 1–3 s per 100 commits). The default limit is 2,000.
- The player's fight is stateful (physics, random moves). When changing it:
  - Change one thing at a time.
  - Keep the event names and payloads stable.
  - Run e2e and look at screenshots after each step.
- The page's overlays cover the sides of the stage. `player.setInsets(left, right)` keeps cards and bars centred between them.
- Chapter titles are generated ("Road to v1.0.0", "The TUI Gremlins", "Chapter 4"). Titles can repeat with " II" suffixes; that is intended.
- Identity merging in git-log mode merges authors who share an exact full name. Hand-written aliases (`--aliases`, see `examples/opencode.aliases.json`) cover the rest.
- Fonts load from Google Fonts with system fallbacks. Offline screenshots show the fallback fonts; that is fine.

## Regenerating the bundled sample

```
git clone --filter=blob:none --bare https://github.com/anomalyco/opencode /tmp/opencode.git
npm run cli -- git /tmp/opencode.git --name anomalyco/opencode --url https://github.com/anomalyco/opencode \
  --aliases examples/opencode.aliases.json -o apps/web/public/samples/opencode.json
```

## Working style for this repo

- Pick the next unchecked task in `docs/ROADMAP.md`. Work in a branch per task and make small commits with clear messages.
- Before writing code, state the plan in a few lines. If a task needs a decision listed under "Open decisions" in the roadmap, ask instead of guessing.
- When a task is done:
  - Tick it in the roadmap.
  - Note anything surprising under that task.
  - Update `README.md` if commands or behavior changed.
