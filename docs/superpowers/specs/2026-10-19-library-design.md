# Story library: design

Agreed with the owner on 2026-10-19. This adds a local backend that keeps a library of collections, each holding stories, where each story is one git repository. The library is managed from the web UI.

## Requirements

### What the owner asked for
- **Collections of stories,** where a story is one repo. Add, rename, move and delete them from the UI.
- **The backend pulls the code** and keeps the folders on disk in the same shape as the collections.
- **Runs on this machine, for the owner only.**
- **Updates:** an Update button per story and per collection. Opening a story that hasn't been fetched in 24 hours also fetches in the background and offers the newer build.
- **Home page:** the library is the home page. Pasting a link adds a story to a chosen collection. The in-browser GitHub fetch is removed.

### No AI processing of repository data (hard requirement)
- **The pipeline has no AI step.** The server runs `git`, and the story engine is deterministic code. There are no model calls and no network traffic beyond the `git clone`/`git fetch` the user asks for. Roadmap task 16 (AI chapter titles) is excluded.
- **Source files are never downloaded.** Clones are blobless (`git clone --bare --filter=blob:none`), so only commit metadata and changed paths reach the disk.
- **Development keeps away from real library data:**
  - Claude never reads, lists or prints library contents.
  - Tests use repos generated inside the test.
  - `.claude/settings.json` denies file reads and edits under `library/`, and `CLAUDE.md` states the rule for shell commands.

## On disk

```
library/                       (default; COMMIT_WARS_LIBRARY overrides; git-ignored)
  <collection-slug>/
    collection.json            { name, description, order: [story slugs], createdAt }
    <story-slug>/
      story.json               { name, url, branch, aliases, titles, createdAt,
                                 fetchedAt, builtAt, head, commits, first, last,
                                 status: "queued"|"cloning"|"building"|"ready"|"error", error }
      repo.git/                blobless bare clone
      history.json             History (rebuild without refetching)
      episode.json             Episode v2, what the player plays
```

- **The folders are the source of truth.** There's no database, and the server re-reads the tree on every `GET /api/library`.
- **Slugs** are made from names: lowercase letters, digits and dashes. A clashing slug gets a suffix (`-2`).
- **Renaming** renames the folder. **Moving** a story moves its folder.
- **Writes are atomic:** the server writes a temp file and renames it into place.
- **Hand-made folders:** a folder without `collection.json` or `story.json` is listed as "not set up" and is never deleted.

## Components

- **`packages/git-source` (Node only, new).** The CLI's `git` command moves here so the CLI and the server share it.
  - `cloneRepo(url, dir)`, `fetchRepo(dir)`, `headOf(dir, branch)`.
  - `readHistory(dir, { branch, name, url })`: runs `git log` with `GIT_LOG_FORMAT`, then `parseGitLog`.
  - `checkGitUrl(url)` rejects:
    - anything starting with `-`
    - transports other than https, ssh, git and file
    - local paths that don't exist
  - Git runs with `GIT_ALLOW_PROTOCOL=https:ssh:git:file` and `GIT_TERMINAL_PROMPT=0`, so a private repo without credentials fails with a readable error instead of hanging.
- **`apps/server` (new).** Node's `http` module, no new dependencies, listens on 127.0.0.1 only.
  - `library.js`: reads and writes the tree (collections, stories, slugs, atomic JSON writes).
  - `jobs.js`: an in-process FIFO queue running one job at a time. A job is either a **build** (clone if missing, read history, build the episode, write files) or an **update** (fetch, then rebuild only if the head moved). Each job reports phase, message and fraction.
  - `api.js`: the routes below, plus server-sent events.
  - `server.js`: the entry point. `--port` defaults to 5174. With `--static apps/web/dist` it also serves the built app.
- **Web (`apps/web`).**
  - `api.js`: a small client with readable errors, as with the GitHub fetcher.
  - `library-ui.js`: the home page with collections, story cards, forms and live status.
  - `main.js`: routes are `#/` (library), `#/s/<collection>/<story>` (movie) and `#/sample/opencode` (bundled sample, still available offline).
  - Removed from the web app: the GitHub fetcher usage, the token box and the IndexedDB episode cache. The server is the cache, and episodes are fetched with ETags. `store.js` keeps localStorage settings only.
  - `npm run dev` runs Vite and the server together (a small Node script, no new dependencies). Vite proxies `/api` to the server. `npm run serve` serves the built app and the API on one port.

## API

| Method | Path | Does |
|---|---|---|
| GET | `/api/library` | Collections in order, each with its stories' summaries (no episodes) |
| POST | `/api/collections` | `{ name, description? }` → creates the folder |
| PATCH | `/api/collections/:c` | `{ name?, description?, order? }` (a rename moves the folder) |
| DELETE | `/api/collections/:c` | Only if empty, unless `?confirm=<slug>` |
| POST | `/api/collections/:c/stories` | `{ url, name?, branch? }` → creates the story and queues a build; 202 `{ story, job }` |
| PATCH | `/api/collections/:c/stories/:s` | `{ name?, branch?, aliases?, titles?, collection? }`. Changing the branch, aliases or titles queues a rebuild from `history.json` (or a refetch for a branch change). `collection` moves the story. |
| DELETE | `/api/collections/:c/stories/:s?confirm=<slug>` | Removes the story folder |
| POST | `/api/collections/:c/stories/:s/update` | Queues an update |
| POST | `/api/collections/:c/update` | Queues an update for every story in the collection |
| GET | `/api/collections/:c/stories/:s/episode` | `episode.json` with an ETag (the build time); 304 when unchanged |
| GET | `/api/events` | Server-sent events: `job` `{ id, story, phase, message, frac, state }` and `library` (something changed) |

- **Errors** are JSON `{ error }` with complete sentences that say what to do. For example, "git can't reach https://… . Check the link, or for a private repo make sure `git clone` works for it on this machine."
- **Validation:** names are 1–80 characters, and URLs are checked by `checkGitUrl`.

## UI

- **Home page:**
  - **Link box:** a URL field, a collection picker (with "New collection…") and an optional name.
  - **One section per collection:** its name and description, plus Update all, Rename and Delete.
  - **Story cards:** name, repo host and path, commit count, date range, "updated 3 hours ago", and status (a progress line while queued or building, the error text on failure).
  - **Card actions:** Play, Update, Rename, Move, Delete (asks first in a confirm panel drawn in the page, not `window.confirm`).
- **Story page:** the movie as it is now, with a breadcrumb back to the collection.
  - **Background check on open:** if `fetchedAt` is more than 24 hours old, the page queues an update. When the update finishes with new commits, a notice says "N new commits · Reload".
- **Live status:** the page subscribes to `/api/events` and updates cards in place.
- **No backend:** if the server isn't running, the home page explains how to start it (`npm run dev`) and still offers the bundled sample.

## Testing

- **`packages/git-source` tests:** build a temporary repo with `git init` and scripted commits (made-up authors, `Fixes #N` bodies), then check that cloning, `readHistory`, `headOf`, fetching new commits and `checkGitUrl` rejections all behave.
- **`apps/server` tests:** start the server on a random port with a temporary library, then:
  - create a collection and add a `file://` story
  - wait for the job events and check that the files exist on disk
  - update with no change (no rebuild), then add commits and update (rebuilt)
  - rename and move (folders move)
  - delete without confirmation (refused), then with it (gone)
  - refuse a bad URL
  - check that the episode ETag returns 304
- **e2e:** start the real server with a temporary library and a generated repo, then drive the UI:
  - create a collection and add a story
  - see its progress and play it
  - update it, rename it, move it and delete it
  - check that the sample still plays without the server
- **No test touches `library/` or the network.**
