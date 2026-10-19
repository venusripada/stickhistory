# Movie timeline: design

Agreed with the owner on 2026-10-19. Replaces the chapter-by-chapter story player with a movie you can scrub by date.

## What the owner asked for

- A movie screen: the fight fills the frame, with a fullscreen button. People and commit-feed panels are translucent overlays that toggle.
- A timeline across the bottom: commits per week as a histogram, chapter spans, release marks and dates. Drag it back and forth through time.
- **Calendar-linear pacing:** every day gets the same screen time.
- Lots of data, not a summary:
  - many more fights (every fix is an enemy on the day it landed)
  - the activity chart
  - who is active now
  - every commit in the feed
- Story beats happen on their dates:
  - the biggest fixes get spotlight duels
  - the chapter boss (Tech Debt) arrives on its refactor's date
  - releases set off fireworks
  - chapters become labelled spans on the timeline
  - "follow one hero" is a filter

## Decisions made on the owner's behalf (they can overrule)

- **Movie length:** about 10 minutes at 1×. Seconds per day = 600 / days, clamped to 0.05–3 s. That is about 1 s/day for opencode and about 6 days/s for ky. Speeds are 0.5×, 1×, 2×, 4× and 8×.
- **Crowd cap:** at most 10 living enemies on stage. Fixes waiting to spawn queue up, and the queue shows as a "+N" swarm. Fixes that wait more than 3 days of movie time are auto-squashed. The feed and the counts always include every commit.
- **Heroes on stage:** up to 6, the people with the most commits in the last 14 days. They walk on and off as activity changes. An enemy whose author is off stage carries the author's colour dot and is fought by whoever is on stage.
- **Episode schemaVersion 2.** Version 1 episodes have no per-commit data. The player refuses them with a message that says to rebuild, and a v1 cache entry is rebuilt automatically.
- **Episode cache:** moves from localStorage to IndexedDB, since episodes are now about 2 MB for 20k commits. localStorage stays for the token and other settings.
- **Page layout:** the old battle log, fight card and HUD meters go away; their information now sits in the overlays. The chapter list (click to seek) and the hero cards (click to follow) stay below the movie.
- **Events change:** the player now emits `time`, `state` and `spotlight`. The old `log`, `now`, `hud` and `progress` events are removed (the feed comes from the timeline, and story beats come from `spotlight`). This is a deliberate API change, made together with the schema bump.

## Architecture

The data drives everything, and the fight re-syncs when you seek.

- **Story engine** (`packages/story-engine`, pure):
  - `buildEpisode` adds `episode.timeline`:
    - `start`, `end`, `days`
    - `people[]`: name, login, avatarUrl, bot, commits; sorted by commits, so a person's index also picks their colour
    - `commits[]`: compact tuples `[day, who, kind, files, type, sha, subject, pr, issues]`, sorted by day
    - `releases[]`: `{ tag, day, weight }`
  - `timeline.js` exports pure functions that the player and the page both call, so numbers are computed in one place:
    - `secondsPerDay`, `weekBuckets`, `totalsAt`, `activeAt`, `commitRange`, `chapterAt`, `isoOfDay`, `dayOfIso`
  - The roster grows to the top 24 people.
- **Player** (`packages/player`), split into modules of 500 lines or less:
  - `theme.js`
  - `poses.js`: poses, moves, figure geometry
  - `draw.js`: figures, enemies, boss and effects
  - `sim.js`: hero, enemy, boss, orb and bolt physics
  - `director.js`: decides what enters the stage between two days (pure, unit-tested)
  - `player.js`: clock, seek, loop, API and events
  - The clock is a fractional day. `seek(day)` clears the stage and restarts the director at that day. Only the decorative animation is approximate after a seek; every number comes from the timeline.
- **Web app:**
  - The movie frame holds the canvas, the date and chapter title, the people overlay, the feed overlay, and the timeline (histogram canvas plus a transparent `<input type=range>` for drag and keyboard) with controls.
  - The frame fills its box. Outside fullscreen it is 16:9; in fullscreen it is the whole screen.
  - Keys: Space plays and pauses, ←/→ move a week, Shift+←/→ jump to the previous or next chapter, F toggles fullscreen, P toggles people, L toggles the feed.

## Testing

- Engine: tests for the timeline shape, for every selector, and that an episode's commit count matches the timeline.
- Director: deterministic tests, such as "between day a and b it spawns exactly these fixes" and "seek resets".
- e2e checks:
  - the movie plays and the date advances
  - dragging the timeline changes the date and the feed
  - the feed lists the commits up to the playhead
  - people panel counts match the engine
  - the fullscreen button
  - follow mode filters the movie to one hero
  - the local git log file still links issues
  - a v1 episode file is refused with a rebuild message
  - no horizontal scroll at 390 px
  - dark theme and embed mode still work
