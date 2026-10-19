# Roadmap

Phases 0 and 1 are done: separate packages, a browser-only app that builds a fight from any GitHub link, a CLI, unit tests and an end-to-end test. This file lists what comes next, in order. Each task has a definition of done; tick the box and add notes when it's finished.

## Open decisions (ask the owner before starting tasks that depend on them)

- **Hosting.** Which platform runs the backend (Fly.io, Railway, Render, Cloudflare Workers + D1/R2, or a VPS)? Default proposal: one Node service with Postgres and Redis on Fly.io or Railway.
- **Private repositories.** Supported in the hosted version from day one, or public-only first? Default proposal: public-only first.
- **Names.** Show GitHub logins and avatars by default, with an opt-out list per repo? Default proposal: yes.
- **Domain and product name.** "Commit Wars" for now.

## Phase 1.5: harden what exists

- [x] **1. Verify on real local clones.** The owner chose local clones over the live GitHub API as the test input, so this task builds episodes from `git log` of blobless bare clones (`git clone --filter=blob:none --bare`) of `sindresorhus/ky` (small), `expressjs/express` (medium, merge commits) and `anomalyco/opencode` (huge, squash merges). It also teaches the `git log` parser to read commit bodies, so "Fixes #123" links issues without the API.
  *Done when* all three build and validate, and the findings are written under this task.
  - **Format change:** `GIT_LOG_FORMAT` now ends in `%x1f%b%x1e`. The body runs until the `\x1e` marker, so bodies may contain any text, including lines starting with `@@@`. Logs made with the old format still parse.
  - **Closing references:** `closingIssues()` uses GitHub's keywords (close/closes/closed, fix/fixes/fixed, resolve/resolves/resolved, optional colon), one keyword per reference as on GitHub. `owner/repo#N` and issue URLs count only when they name the same repo, and `(#123)` PR suffixes and "see #5" are ignored. History commits gain an optional `issues` array; the engine uses it when the commit has no PR data.
  - **Issue titles are unknown locally,** so Episode issue titles may be `null` (schema loosened; version 1 episodes stay valid). The duel is titled by the commit, and `cleanTitle()` now drops trailing "… Closes #199".
  - **Results** (whole history, Node 22, WSL2): clones took 0 s, 1 s and 11 s. `git log` + parse + build:

    | repo | commits | log size | git log | parse | build | commits closing issues | fix enemies linked to an issue (on screen) |
    |---|---|---|---|---|---|---|---|
    | ky | 592 | 0.2 MB | 14 ms | 3 ms | 8 ms | 52 | 0 → 9 of 62 |
    | express | 6,182 | 1.4 MB | 106 ms | 19 ms | 41 ms | 564 | 0 → 41 of 145 |
    | opencode | 20,580 | 10.1 MB | 771 ms | 52 ms | 212 ms | 51 | 0 → 5 of 651 |

  - **Surprises:** express's old commits put "Closes #N" in the subject, so most of its links come from subjects. Opencode squash-merges with "(#N)" PR numbers but rarely writes closing keywords, so locally it gets few issue enemies; GitHub's PR data would add more. Duel titles containing "null" or "undefined" are real commit text ("headers set to `undefined`"), not missing values.
- [ ] **1b. Verify against the real GitHub API (deferred).** Still never run against the real API. Before Phase 2 depends on it: build ky, express and opencode with a read-only token and without one, record time per 100 commits, GraphQL `rateLimit.cost`, any 502 or timeout, whether file counts and closing issues come back, and the CORS and rate-limit headers in a real browser.
- [ ] **2. Faster GraphQL fetch.** If task 1 shows slow pages, add parallelism. One option is splitting history by `since`/`until` date windows fetched 3 at a time, then merging and deduping by sha. Respect `rateLimit.remaining`.
  *Done when* 5,000 opencode commits fetch at least 2× faster than in task 1 without secondary rate limits.
- [ ] **3. Merge-commit repos.** Repos that merge PRs with merge commits (not squash) currently attribute fixes to merge commits poorly. Use the PR's own title and labels to classify the PR's commits as a group, and make the merge commit itself never a fighter.
  *Done when* a fixture test shows a merge-workflow repo produces duels named after real PR titles.
- [x] **4. Split `player.js`.** Move pure pieces (poses, enemy drawing, effects, layout helpers) into their own modules inside `packages/player/src/`. Keep the public API and events unchanged.
  *Done when* no file is over ~500 lines, e2e passes and the screenshots are unchanged.
  - Done as part of the movie timeline rewrite (spec: `docs/superpowers/specs/2026-10-19-movie-timeline-design.md`), so the public API and events did change on purpose:
    - The player now plays calendar time and seeks by day.
    - It emits `time`, `state` and `spotlight`.
    - Episodes are schemaVersion 2.
  - Modules: `player.js` (389 lines), `sim.js` (486), `draw.js` (386), `director.js`, `poses.js`, `theme.js`, `util.js`.
  - Task 5 is partly covered: `director.js` is pure and has deterministic unit tests. The physics still uses `Math.random`.
- [ ] **5. Player tests.** Add a headless test that loads an episode, steps the simulation a fixed number of frames with a seeded random source, and asserts on emitted events (a duel starts, a duel is won, a chapter ends). This needs an injectable random function and clock in `createPlayer`.
  *Done when* the test is deterministic across 10 runs.
- [ ] **6. Accessibility pass.** Do a keyboard-only run-through, check screen-reader text for the fight card and log, check contrast in both themes, and make sure reduced motion starts paused with a clear Play button.
  *Done when* the fixes are made and noted here.

## Phase 2: backend

- [x] **Local library server (owner's request, 2026-10-19).** Built before tasks 7–12 as a single-user, local version: `apps/server` keeps collections and stories as folders (`library/<collection>/<story>/`), clones with `git` (blobless), builds episodes in a one-at-a-time job queue, and serves the web app's library UI. Spec: `docs/superpowers/specs/2026-10-19-library-design.md`. This settles the hosting question for now (this machine), private repos (work through the machine's git credentials) and the in-browser GitHub fetch (removed from the web app). Tasks 7–12 below remain for a hosted, multi-user version.

- [ ] **7. Service skeleton.** Create `apps/server`: a Node HTTP API (Fastify or Hono) with Postgres for repos, episodes and jobs, and Redis + BullMQ for the job queue. Reuse `@commit-wars/github-fetcher` and `@commit-wars/story-engine` unchanged. Add a Dockerfile, health check and local `docker compose up`.
- [ ] **8. GitHub App auth.** Register a GitHub App with read access to contents, metadata, pull requests and issues. Server-side installation tokens give higher rate limits; with the owner's install, private repos work too. Never send tokens to the browser.
- [ ] **9. Build jobs.** `POST /api/repos/:owner/:repo/build` queues a job. `GET /api/jobs/:id` (or server-sent events) streams progress messages in the same shape as `onProgress`. `GET /api/episodes/:owner/:repo` returns the latest episode with an ETag.
- [ ] **10. Incremental updates.** Store the History, not just the Episode. On rebuild, fetch only commits newer than the stored head sha, append them, and rebuild the episode. Make old histories rebuildable when the engine version changes.
- [ ] **11. Web app uses the server when present.** If `VITE_API_URL` is set, `#/r/owner/repo` asks the server first and falls back to in-browser fetching. Then deploy both.
- [ ] **12. Limits and abuse.** Rate-limit builds per IP, cap history size per plan, and add a denylist for repos whose owners opt out.

## Phase 3: polish and reach

- [ ] **13. Video and GIF export.** First in the browser with MediaRecorder on the canvas. Later, server-side rendering with headless Chromium for consistent output and an `/api/episodes/:owner/:repo.mp4` endpoint.
- [ ] **14. README badge and embed.** Serve `/embed/owner/repo` for iframes, plus a static SVG or animated GIF badge that links to the replay.
- [ ] **15. GitHub Action.** Rebuild the episode on each release and commit `commit-wars.json`, or upload it to the service.
- [ ] **16. AI chapter titles (optional). Excluded for now:** the owner does not want repository data processed by any AI. Do not start this without their explicit approval.
  Original idea: Feed each chapter's top PR titles to a model to get a chapter title and a one-line summary. Keep the deterministic titles as a fallback, and cache the AI output by chapter content hash.
- [ ] **17. More sources.** Add History adapters for GitLab and Bitbucket. The engine and player should not change.
