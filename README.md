# Filo — file-based todos for Obsidian

Filo treats every task as its own markdown file. Relationships, status, due
dates, tags and time-tracking all live in the file's frontmatter and body, so
your tasks are plain, portable, link-friendly notes — not rows in an opaque
database.

## Install

1. Copy this folder to your vault: `.obsidian/plugins/filo/`.
2. From inside that folder:
   ```bash
   npm install
   npm run build
   ```
   This produces `main.js`. (`npm run dev` watches and rebuilds while you work.)
3. In Obsidian: **Settings → Community plugins**, reload/refresh, and enable
   **Filo**.

> Requires Obsidian 1.4.0+ (uses `Vault.process` and `processFrontMatter`).

## Task file format

Each task is a file named `<id>.md` inside the tasks folder (default `tasks/`):

```markdown
---
id: t-k3p9af2x          # generated stable random id — never derived from title
title: Write the report
status: undone          # undone | in-progress | done
parent: t-9af2k3p9      # parent task id, or null
due: 2026-06-30         # YYYY-MM-DD, or null
tags: [backend, docs]
priority: 0             # ranking number; new tasks start at 0
created: 2026-06-14T10:00:00.000Z
---

Free-form notes about the task go here.

```t-time
start: 2026-06-14T10:00:00.000Z
stop: 2026-06-14T10:45:00.000Z
start: 2026-06-14T13:00:00.000Z
stop: running
```
```

Key rules:

- **`id` is the source of truth** for every relationship. The filename is
  `<id>.md`, so renaming a task's `title` never moves the file or breaks links.
- **`priority` is a plain number**, defaulting to `0`. It's written on creation
  and edited in place from a `t-list` row (see [`t-list`](#t-list--filtered-task-list)).
  Any number works — negatives and decimals included. A task file with no
  `priority` (or a non-numeric one) reads as `0`, so tasks created before the
  field existed need no migration; they gain the line the first time you edit
  their priority.
- **`parent` is the only stored link.** There is no `children` array — children
  are derived by scanning the tasks folder. The scan is cached and invalidated
  on any create/modify/delete/rename inside the tasks folder.
- **The `t-time` block** stores discrete sessions as `start`/`stop` pairs, and
  **renders the task's timer controls** on the task page itself (see
  [`t-time`](#t-time--on-page-timer) below).
  Total tracked time = sum of `stop − start`. A trailing `stop: running` (or a
  `start` with no matching `stop`) means the timer is active. A running session
  longer than the configured cap (default 12h) is **flagged** (console warning
  + red highlight) and its time is capped rather than counted silently.
  The older `timekeeper` fence is still **read** for backwards compatibility,
  and is rewritten as `t-time` the next time the task's sessions change.

Only **one timer runs at a time, globally.** Starting a timer stops any other
running one. The active task id is persisted, so it's remembered across reloads.

## Recurring tasks

A task can **repeat on a cadence while reusing the same file** — handy for habits
like *"practice rust"*. A recurring task carries three extra frontmatter fields:

```markdown
---
id: t-k3p9af2x
title: Practice rust
status: done
recurring: true
cadence: 0 0 * * *      # standard 5-field cron expression
lastReset: 2026-06-21T00:00:00.000Z
---
```

- **`cadence`** is a standard 5-field cron string (`minute hour day-of-month
  month day-of-week`). Day-of-week is `0–6` with `0 = Sunday` (`7` also = Sunday).
  `*`, lists (`1,3,5`), ranges (`1-5`), and steps (`*/2`, `1-9/2`) are supported.
- **`lastReset`** marks the boundary of the period the task is currently in. It
  starts at creation time, so the first reset happens at the first cron boundary
  *after* the task was made.

When a cadence boundary has elapsed since `lastReset`, the task is **reset**: the
status it held at the boundary is appended to a **recurrence-log table** in the
file body, its `status` flips back to `undone`, and `lastReset` advances to the
boundary. The log lets you see which days you actually completed the task:

```markdown
## Recurrence log

<!-- filo-log -->

| Date | Status |
| --- | --- |
| 2026-06-20 | done |
| 2026-06-21 | undone |
| 2026-06-22 | in-progress |
```

> Only the most recent missed boundary is logged per run; if several periods
> elapse between runs (e.g. you didn't open the vault for a week), intermediate
> periods aren't back-filled.

Resets are applied by the **Filo: Load tasks (process recurring)** command, and —
unless disabled in settings — automatically when the plugin loads. In a `t-list`,
recurring tasks show a **⟳** marker before the title (hover for the cadence).

You mark a task recurring and pick its cadence **when creating it** — both the
**Create task** dialog and the inline `t-add` form expose a *Recurring* toggle
and a cadence picker (Daily / Weekdays / Weekly / Monthly presets, or a custom
cron expression).

When you open a task file, **task controls** appear in the note's top action bar
(the icon row at the top, alongside the other view actions):

- a **start/stop timer** toggle (▶ when stopped, ■ while running; total tracked
  time in its tooltip);
- **go to parent task** (↖, shown only when the task has a parent);
- **go to child task** (↘, shown only when the task has children — opens the
  single child, or pops a menu to pick when there are several);
- **open task canvas** (▦) — builds/refreshes an Obsidian Canvas holding this
  task and its subtree, then opens it (see [Task canvas](#task-canvas)).

They work in both reading and editing modes and stay in sync as tasks change.

The **bottom status bar** shows your **current task** — the one being timed if a
timer is running (with live elapsed time), otherwise the last task you opened.
Click it to jump straight to that task. The current task is remembered across
reloads.

## Code blocks

### `t-add` — quick task creator

````markdown
```t-add
```
````

Renders a persistent inline form: title, due date, tags (comma-separated), and
a parent picker populated from existing tasks. **Create** writes a new task file
and clears the inputs so you can keep adding.

If the note containing the `t-add` block is **itself a task**, the parent picker
defaults to that task (shown as *"… (this task)"*), so tasks added from within a
task become its children automatically. You can still override the parent
manually — your choice sticks until the next time the form resets.

### `t-time` — on-page timer

````markdown
```t-time
start: 2026-06-14T10:00:00.000Z
stop: 2026-06-14T10:45:00.000Z
```
````

Every task file carries one. It is **both** the storage for that task's sessions
**and** its timer UI: the block renders the running total (ticking live while a
timer runs), a running/session-count indicator, **Start** and **Stop** buttons,
and a collapsible list of the individual sessions (since the raw `start:`/`stop:`
lines are hidden once the block renders).

Start and Stop are separate buttons; the one that doesn't apply to the current
state is disabled rather than hidden, so the row doesn't reflow when the timer
flips. They go through the same store as every other timer entry point, so the
**one-timer-at-a-time** rule still holds — starting here stops whatever else was
running, and the header action, the `t-list` row and the status bar all update.

A `t-time` block in a note that **isn't** a task renders a short notice instead
of controls: there's no task id to attribute the time to.

### `t-list` — filtered task list

````markdown
```t-list
status: undone
due: <2026-06-30
tags: backend, docs
sort: priority desc
group: parent
```
````

The body is a simple line-based DSL (`key: value`, one per line; blank lines and
`#` comments ignored):

| Key      | Examples                                   | Meaning |
|----------|--------------------------------------------|---------|
| `status` | `status: undone`, `status: undone, in-progress`, `status: !done` | Status match. Comma = OR-set; a leading `!` negates (so `!done` = everything still open). |
| `due`    | `due: <2026-06-30`, `due: >2026-01-01`, `due: =2026-06-30`, `due: overdue` | Date comparison with `<`, `>`, `=`; `overdue` = due before today and not done. |
| `tags`   | `tags: backend, docs`                      | Matches if the task has **any** listed tag (comma = OR). |
| `time`   | `time: today`, `time: yesterday`, `time: 7d`, `time: 2026-08-19`, `time: 2026-08-01..2026-08-25` | Keep only tasks **worked on** in that window, scope every time figure to it, and show a **summed total** under the list. See [Time reporting](#time-reporting). |
| `sort`   | `sort: due asc`, `sort: time desc`, `sort: priority desc` | Sort by `due`, `created`, `title`, `time` (tracked time), or `priority`. `asc`/`desc` (default `asc`, so **`sort: priority desc` puts the highest priority first**). |
| `group`  | `group: parent`, `group: none`             | `parent` buckets rows under their immediate parent's title; `none` (alias `flat`) drops the tree entirely and renders one list in pure `sort` order. Both are alternatives to the default tree. |

By default the list renders as a **nested tree** — children sit indented beneath
their parent, with sibling order following `sort`. A matched task whose parent
is filtered out becomes a top-level row, so filters never hide a matching child.

Each row shows: a **status toggle** (cycles undone → in-progress → done), the
title (click to open the file), an **editable priority** box, the due date (red
if overdue), tags, total tracked time, a **Start/Stop** timer button, and a **＋**
button that reveals an inline form to add a **child task** (parented to that
row's task). The timer
button mutates the *target* task's file. A running timer's elapsed time **ticks
live** every
second; the interval is registered on the block's lifecycle and cleaned up when
the block unloads. Rows re-render automatically when task files change.

Editing the **priority** box writes straight to that task's frontmatter: type a
number and commit with **Enter**, **Tab**, or by clicking away (the spinner
arrows commit too); **Escape** discards the edit. Combine with `sort: priority
desc` to keep the list ordered by what matters most — but note that in the
default tree layout sorting only orders **siblings**, so a low-priority parent
still sits above its high-priority children. Add `group: none` for a strictly
priority-ordered flat list:

````markdown
```t-list
status: !done
sort: priority desc
group: none
```
````

## Time reporting

A `time:` line turns a `t-list` into a timesheet: the list keeps only tasks with
tracked time in that window, each row's time column shows **time in the window**
rather than the lifetime total, and a **total** is summed underneath.

How long did I work today?

````markdown
```t-list
time: today
sort: time desc
group: none
```
````

Accepted windows:

| Value | Span |
|-------|------|
| `today` / `yesterday` | That single day. |
| `2026-08-19` | That single day. |
| `7d`, `30d` | A rolling window of N days **ending today** (so `1d` = today). |
| `week` / `month` | Aliases for `7d` / `30d` — rolling, not calendar. |
| `2026-08-01..2026-08-25` | Between two dates, inclusive. Reversed bounds are accepted. |

Details worth knowing:

- **Days are local days**, midnight to midnight in the vault's timezone, and
  sessions are **clipped** to the window — a session from 23:00 to 01:00 counts
  an hour toward each of the two days rather than landing wholly in one.
- A running timer is included up to *now* and keeps ticking live in the row and
  the total — but only when the window contains now, so last week's report
  doesn't move.
- The usual safety cap still applies: a running session older than **Timer max
  duration** contributes only the cap and is flagged.
- `sort: time` sorts by windowed time too, so `sort: time desc` puts the day's
  biggest sink on top.
- Other filters still compose. Today's work on one project:

````markdown
```t-list
time: today
tags: backend
```
````

## Setting a parent by title

Relationships are stored as ids (`parent: t-a3ypcqc7`), which is what makes them
survive renames — but it means Obsidian's built-in **properties editor can only
ever show you that raw id**, and its value dropdown suggests other raw ids. That
widget has no plugin hook, so Filo puts a readable control above it instead.

Every task note gets a **parent banner** at the top:

```
PARENT   Ship the parser rewrite                              ⌐
```

- Click the title to open a **fuzzy picker of task titles** (most recently
  modified first, same ordering as the `/t` dropdown). Choosing one writes that
  task's **id** to `parent` in frontmatter — display is by title, the link is by
  id.
- With no parent set the banner reads *"Set parent…"*; once one is set, a
  `(no parent)` row appears in the picker to clear it.
- The ⌐ button on the right jumps to the parent note.
- The picker **excludes the task itself and all of its descendants**, so you
  can't reparent a task under its own child and create a cycle.
- If `parent` points at an id no task has, the banner shows
  *"⚠ missing task t-xxxx"* in red rather than silently reading as "no parent" —
  the id is the clue you need to fix it.

Turn it off with **Parent banner on task notes** in settings.

## Referencing tasks inline (`/t`)

Anywhere in a note, type **`/t`** and a dropdown of your tasks appears —
**sorted by file modified date, most recent first**. Keep typing to filter
(fuzzy, matching titles *and* tags), use ↑/↓ to navigate, and ↵ or a click to
insert.

```
Blocked on /t          →  Blocked on [[t-k29fj1|Ship the parser rewrite]]
Blocked on /tparser    →  (same, filtered to matching titles/tags)
```

Because task files are named after their opaque id, the inserted link is always
**aliased to the task title** so it reads normally in the note. The link itself
is built with Obsidian's own link generator, so it respects your *Use
`[[Wikilinks]]`* and link-format preferences.

Details:

- The trigger only fires at the **start of a line or after a space**, so paths
  and URLs like `notes/tasks` never open it.
- Each row shows the status glyph (`○` undone, `◐` in-progress, `●` done), the
  title, then due date, tags, and how long ago the file was modified.
- The dropdown closes on `esc`, or as soon as nothing matches what you've typed.
- Trigger text, result count, and whether done tasks are listed are all
  configurable in **Settings** (below).

## Commands (Ctrl/Cmd-P)

- **Filo: Create task** — opens a dialog (title, due, tags, parent) and writes a
  new task file. If the active file is itself a task, the parent defaults to it
  (shown as *"… (current)"*); you can override it in the dialog.
- **Filo: Create child of current task** — same dialog, only shown when the
  active file is a task, with that task pre-selected as the parent.
- **Filo: Load tasks (process recurring)** — scans recurring tasks and resets any
  whose cadence has elapsed (see **Recurring tasks** above).
- **Filo: Open task canvas** — see below.
- **Filo: Digest canvas into tasks** — only shown on a canvas; see below.

## Task canvas

Press the **canvas button** in a task note's top action bar (next to the timer
and the parent/child nav buttons), or run **Filo: Open task canvas** from the
command palette.

- The button builds (or refreshes) the canvas for that task and opens it — in a
  new tab, or by focusing and reloading the tab that already has it open.
- From the command palette: if run from inside a task file that task is the
  root; otherwise you're prompted to pick one.
- It walks the subtree (`parent → child`) and writes an Obsidian Canvas into the
  configured canvas folder, with `file` nodes pointing at each task note and
  edges from parent to child. Editing a node edits the task note itself.
- Layout is an **inverted tree**: the root on top, each generation in a row
  below the last (**depth → y axis**), every parent centered over its children,
  and edges running bottom → top.
- Cards are **640 × 640** — roughly 80 characters across and down — so a task
  note is readable on the board rather than a title-sized strip.
- **Re-running updates the existing canvas:** nodes are matched by task id,
  **manual positions are preserved**, only new nodes are auto-laid-out (nudged
  down a row if a card you moved is already sitting in their slot), removed
  tasks are pruned, and colors are refreshed. Foreign (non-Filo) nodes/edges are
  left untouched.
- Cards you resized by hand keep their size. Cards still at a size Filo itself
  generated are bumped to the current default — and a canvas built entirely by
  an older Filo (small cards, left-to-right layout) is **laid out afresh** the
  first time it's opened, since the old spacing can't hold the bigger cards.

### Editing tasks from the canvas

A Filo canvas has a **digest button** (🌱) in its own action bar. Draw on the
board, hit it, and the task tree is made to match:

- **New text cards become tasks.** The first line is the title (a leading `#`,
  `-` or `- [ ]` is stripped), the rest becomes the note's body. The task file is
  created as `<tasksFolder>/<id>.md` like any other.
- **Note cards are adopted.** A card pointing at an ordinary note gets Filo
  frontmatter merged in (whatever it already had is kept), a `t-time` block, and
  is **renamed** into the tasks folder as `<id>.md` — links to it are rewritten.
- **Edges are parenthood.** A card hanging under another becomes that task's
  child; a new card nothing points at becomes a child of the **canvas root**
  (the task the canvas was built from). Drawing an edge between two *existing*
  tasks re-parents the lower one, so you can restructure by dragging.
- Everything else is left alone: groups, web links, images, PDFs, blank cards.

Afterwards the canvas is rebuilt from the resulting tree, in place: new cards
stay where you dropped them, now backed by real task notes and wired up with
generated edges. Your hand-drawn edges are replaced by the canonical ones rather
than doubled.

Two deliberate limits:

- **Deleting a card does not delete the task** — the rebuild simply puts the card
  back. Removing tasks is left to the task files themselves, since a stray
  delete on a canvas is far too easy.
- An edge that would make a task its own ancestor is **refused**, and reported in
  the summary as *skipped (would loop)*. So a card drawn above the root becomes a
  child of the root rather than a new root.

The button only appears on canvases that already hold a Filo task, since a
digest needs a root to hang new cards from. Start one from a task note with the
canvas button, then edit it freely.

### Canvas file naming

The canvas is named after the **task's title** (`Ship Filo v2.canvas`), with
characters a file name can't hold replaced by spaces.

Titles are neither stable nor unique, so the file is *looked up*, not just
computed:

- The canvas rooted at the task is found wherever it sits in the canvas folder —
  including under the old `<taskId>.canvas` name — and is **renamed to follow
  the title** when the task is renamed, so manual layout survives.
- If that name is already taken by an unrelated canvas (e.g. two tasks share a
  title), the id is appended: `Ship Filo v2 (t-k3p9af2x).canvas`. Filo never
  merges task nodes into a canvas that isn't its own.

### Canvas color limitation

Obsidian Canvas node colors support **only the preset palette `"1".."6"`**, not
arbitrary hex:

```
1 red   2 orange   3 yellow   4 green   5 cyan   6 purple
```

Filo approximates a "cold → hot" gradient by bucketing tracked time onto the
rainbow ordering of those presets — `purple(6) → cyan(5) → green(4) →
yellow(3) → orange(2) → red(1)` — so the **most-tracked task is reddest**. This
is a documented approximation, not a continuous gradient.

- **Relative mode (default):** time is normalized to the longest task in the
  subtree, so the longest task is always red.
- **Absolute mode:** fixed hour thresholds (0.25h / 1h / 2h / 4h / 8h) decide
  the bucket.

## Settings

- **Tasks folder** — where task files live (default `tasks`).
- **Canvas output folder** — where `.canvas` files are written (default: vault
  root).
- **Timer max duration (hours)** — running-session safety cap (default `12`).
- **Redness mode** — relative-to-subtree (default) or absolute thresholds.
- **Process recurring tasks on load** — auto-run the recurring-task reset when
  the plugin loads (default on).
- **Inline task autocomplete** — enable the `/t` task-reference dropdown
  (default on).
- **Trigger text** — what opens that dropdown (default `/t`).
- **Dropdown results** — how many tasks it lists (default `20`).
- **Hide completed tasks** — omit done tasks from the dropdown (default off).
- **Parent banner on task notes** — show the click-to-change parent title banner
  (default on).

## Project layout

```
src/
  main.ts                 plugin entry: events, processors, command, settings
  types.ts                Task / TimeSession / query types
  settings.ts             settings + settings tab
  store/
    id.ts                 stable random id generation
    timeBlock.ts          t-time parse/serialize + total/format
    recurrence.ts         cron parsing + recurrence-log table read/write
    mtime.ts              file-mtime lookup + "most recently modified" ordering
    TaskStore.ts          core service layer (CRUD, tree, timers, recurrence, cache)
  dsl/filter.ts           t-list DSL parser + matcher + sort
  processors/
    addProcessor.ts       t-add widget
    listProcessor.ts      t-list widget (live ticks, lifecycle cleanup)
    timeProcessor.ts      t-time widget (start/stop buttons, live total)
  ui/
    fileTimerButton.ts    in-file timer, parent/child nav, canvas actions
    canvasActions.ts      digest button on Filo canvases
    statusBar.ts          bottom-bar current-task indicator
    taskSuggest.ts        inline `/t` task-reference autocomplete
    parentBanner.ts       parent-by-title banner + cycle-safe parent picker
  canvas/canvasImport.ts  subtree → canvas (title-named, position-preserving merge)
  canvas/canvasDigest.ts  canvas → tasks (create/adopt cards, re-parent by edge)
```
