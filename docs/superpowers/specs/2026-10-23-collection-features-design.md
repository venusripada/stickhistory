# Features of a collection: everything that changed for one feature, across repositories

## Goal

In a collection (for example *sailthru*), the owner types a feature name ("liveserve") and gets everything that went into that feature across all the collection's repositories: every matching commit with its repo, date, author and link, who worked on it, and a movie of just that work. It is built and shared the same way as a period.

Repository data still never goes through AI: matching is deterministic code over `git` metadata.

## What counts as a match

A feature name is 2–40 characters: letters, digits, spaces, `-` and `_`, with at least one letter or digit. It is compared with separators ignored and in any case, as a whole word: "liveserve", "Live Serve", "live-serve", "live_serve" and "LiveServe" all match each other; "liveserver" and "myliveserve" do not.

A commit matches through one or more **signals**:

| signal | where |
|---|---|
| `text` | the commit subject, its body, or a merge commit's pull request title |
| `scope` | a conventional-commit scope, `feat(liveserve): …` |
| `path` | any changed file path (a folder or file name) |
| `branch` | a merge commit's branch: "Merge pull request #N from org/liveserve-retries", "Merge branch 'liveserve-x'" |
| `via-branch` | a commit that a matching merge brought in (`findPullRequests`) |

Every result lists its signals, so a passing mention can be told apart from real work.

## Engine (`packages/story-engine`)

- `git-log.js`: `parseGitLog` keeps an optional `body` on each commit (the text after the subject, trimmed, at most 2,000 characters; absent when empty). `HistoryCommit` gains `body?: string` in `types.js`. `historyVersion` stays 1 and the Episode does not change. Histories without bodies still work; they match on less until their story is re-read.
- New `feature.js` (pure):
  - `checkFeature(name)` → `{ name, id, label }` (id is a slug of the name). Throws a plain-language Error for a bad name.
  - `featureSignals(commit, name)` → the direct signals of one history commit.
  - `cutFeature(history, name)` → `{ history, signals }`: the history with only the matching commits (and their tags), and `signals` mapping sha → signal list. Members of a matching branch get `via-branch` added.
  - `featureReport(ep, { name, collection, signals })` → the period report's sections (totals, stories, developers, features, fixes, releases), with `kind: 'feature'`, `name`, `label` "liveserve", `from`/`to` set to the first and last matching day, and a `changes` list, newest first: `{ repo, title, who, d, sha, url, files, signals }`.
- `period.js`: `periodReport`'s body moves into a shared helper so the feature report reuses it. The period report's output is unchanged.

## Server (`apps/server`)

- Storage: `<collection>/_features/<id>/` with `feature.json` (`{ id, name, label, status, error, builtAt, engine, commits, people, repos }`), `episode.json` (absent when there are too few commits for a movie) and `report.json`. The collection's info lists `features`.
- Jobs: `enqueueFeature(collectionId, featureId)` shares the period queue and job line. The worker gets `kind: 'feature'`: combine histories, `cutFeature`, build the episode (report only when too small), write `featureReport`. No match fails with: *No commits in this collection mention "liveserve" in a message, branch, scope or file path. Check the spelling, or re-read the stories so commit bodies are searched too.* `recover()` rebuilds half-built features and those from an older engine. After a collection movie is combined again, its features are rebuilt.
- API (changes local-only, like periods):
  - `POST /api/collections/:c/features` `{ name }` → 202 `{ feature, job }`; the same name again returns the existing feature.
  - `POST /api/collections/:c/features/:id/rebuild`, `DELETE /api/collections/:c/features/:id`.
  - `GET /api/collections/:c/features/:id/(episode|report|share)`; share is the one-file .html download.

## App (`apps/web`)

- Library: a **Features** panel per collection, under periods. A name box ("Feature name, like liveserve") and a **Find** button for this machine; rows with name, status or job progress, counts, and Movie, Report, Download, Rebuild, Delete.
- Routes: `#/c/<collection>/f/<id>` (movie, `/dev/<name>` follows one developer) and `#/c/<collection>/f/<id>/report`, with the Movie | Report tabs and crumbs "sailthru › liveserve". A downloaded feature file plays like a period file.
- Report: the period report plus a **Changes** section first: date, repo, title (linked), author, files (hidden when unknown), and signal chips. Rows sort by date, repo or author and filter to one repo; this only reorders or hides rows the server sent. Works at 390px, light and dark.

## Testing

- Engine (vitest): each signal; name variants and near-misses; branch members; histories without bodies; body parsing and clipping; period report unchanged.
- Server (vitest): create, build, list, no-match error, delete, a bad id.
- E2E: two generated repos with a made-up feature "rocketpad" (subject, scope, path, merged branch with members, a "rocketpadder" decoy). Make it, wait, open the report, check counts, chips, the decoy's absence and the repo filter; open the movie; fetch the download. Screenshots at desktop and 390px.

## Out of scope

Ticket keys, aliases for a feature's old names, and editing a feature's name after it is made.
