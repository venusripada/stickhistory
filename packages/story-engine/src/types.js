// Shared data shapes, documented with JSDoc so editors can type-check callers.
// Nothing here runs; the file exists for the typedefs.

/**
 * A repository history in a source-neutral shape. The GitHub fetcher, the
 * local `git log` parser and anything else that feeds the story engine
 * produce this.
 *
 * @typedef {object} History
 * @property {1} historyVersion
 * @property {{ owner: string|null, name: string, url: string|null, defaultBranch: string|null }} repo
 * @property {'github-graphql'|'github-rest'|'git-log'|'collection'} source
 * @property {boolean} truncated     True when only the newest `commitLimit` commits were fetched.
 * @property {number|null} commitLimit
 * @property {number|null} totalCommits  Total commits on the branch when the source knows it.
 * @property {string} fetchedAt      ISO timestamp.
 * @property {HistoryCommit[]} commits  Any order; the engine sorts by date.
 * @property {{ name: string, sha: string }[]} [tags]  Tags pointing at commits (also allowed inline on commits).
 * @property {{ name: string, url: string|null }[]} [repos]  Collections only: the combined repositories (see combineHistories).
 */

/**
 * @typedef {object} HistoryCommit
 * @property {string} sha
 * @property {string} date            ISO date or date-time; only YYYY-MM-DD is used.
 * @property {string} message         First line of the commit message.
 * @property {string} [body]          The rest of the message, trimmed, at most 2,000 characters (git log mode).
 * @property {{ name: string|null, email: string|null, login: string|null, avatarUrl?: string|null }} author
 * @property {number|null} files      Number of files changed, or null when the source can't say.
 * @property {string[]|null} [paths]  Changed file paths when known (git log mode).
 * @property {HistoryPR|null} [pr]    The pull request this commit landed through.
 * @property {HistoryIssue[]} [issues] Issues the commit message closes ("Fixes #12"), used when there is no PR data.
 * @property {string[]} [tags]        Tag names pointing at this commit.
 * @property {number} [parents]       Parent count; 2+ means a merge commit.
 * @property {string[]} [parentShas]  Parent commits, first parent first (git log mode).
 * @property {string} [mergeTitle]     A merge commit's pull request title, from its body (git log mode).
 * @property {number} [repo]          Collections only: index into History.repos.
 */

/**
 * @typedef {object} HistoryPR
 * @property {number} number
 * @property {string} title
 * @property {string[]} labels
 * @property {HistoryIssue[]} issues  Issues the PR closes.
 */

/**
 * @typedef {object} HistoryIssue
 * @property {number} number
 * @property {string|null} title  Null when the source only saw a reference (git log mode).
 * @property {string[]} labels
 */

/**
 * A fix commit turned into an enemy.
 *
 * @typedef {object} Fix
 * @property {string} sha
 * @property {number|null} pr
 * @property {{ number: number, title: string|null }[]} issues
 * @property {string} t      Short display title (the issue title when one is linked and its title is known).
 * @property {string} s      Original commit subject, clipped.
 * @property {string|null} sc  Conventional-commit scope.
 * @property {string} d      YYYY-MM-DD
 * @property {number|null} files
 * @property {string} area   Top-level area of the code it touched, when known.
 * @property {'gremlin'|'beetle'|'crawler'|'wraith'|'moth'|'bomb'} type
 */

/**
 * Every commit of an episode, for the movie player (episode.timeline).
 *
 * @typedef {object} Timeline
 * @property {string} start   YYYY-MM-DD of day 0.
 * @property {string} end
 * @property {number} days    end - start + 1.
 * @property {{ name: string, login: string|null, avatarUrl: string|null, bot: boolean, commits: number }[]} people  Busiest first.
 * @property {TimelineCommit[]} commits  Sorted by day.
 * @property {{ tag: string, day: number, weight: number }[]} releases
 * @property {{ name: string, url: string|null }[]} [repos]  Collection episodes only.
 * @property {{ kind: 'feature'|'debt'|'release', title: string, who: string|null, at: number|null, day: number, start?: number, tag?: string, files: number|null, k?: number, members: number[] }[]} [groups]
 *   Bosses that spawn their work (groups.js).
 */

/**
 * [day, who, kind, files, type, sha, subject, pr, issues]; `C` in timeline.js names the slots.
 *
 * @typedef {[number, number, 'fix'|'feat'|'refactor'|'revert'|'merge'|'other', number|null, string|null, string, string, number|null, number[]|null]} TimelineCommit
 */

export {};
