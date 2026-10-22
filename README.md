# Gantt Editor

> **Note:** This app is fully vibe coded. It was built through iterative conversation with an AI assistant rather than hand-designed up front, so expect some rough edges, historical quirks, and inconsistent styling in places. It works, but treat the code as exploratory rather than production-grade.

A browser-based Gantt chart editor with two-way ClickUp sync, dependency tracking, critical path highlighting, and export to PNG/PDF. No backend — everything runs client-side.

## Features

- **Split-panel editor**: task list on the left, Gantt chart on the right, resizable divider between them.
- **Dateless tasks**: tasks can exist without start/end dates and still show up in the list.
- **Milestones**: zero-duration markers (diamond glyph) alongside regular date-ranged tasks.
- **Subtasks**: nest tasks to any depth and collapse / expand them in both panels. Add, indent (Tab), outdent (Shift+Tab), move or detach them from the row menu, by drag and drop (drop on the middle of a row to nest) or from the task popup. Dragging a parent bar moves its subtasks along, and a thin line under the parent shows where its subtasks lie.
- **Dependencies**: click-to-connect arrows between tasks, with drag/resize propagation to successors.
- **Critical path**: toggle highlighting of the longest duration-weighted dependency chain, scoped to the whole project or just the current view.
- **Task detail popup**: status, priority, assignees, tags, description, and dependency editing in one place.
- **Export**: redraw the chart as a PNG or a paginated/print-ready PDF, independent of what's currently scrolled into view.
- **ClickUp sync**: manual two-way sync of tasks, dates, dependencies, priority, description, assignees, status, tags, task type and the subtask hierarchy against a ClickUp list.
- **Portfolio view** (header switch `Board | Portfolio`, bookmarkable at `#/portfolio/<tab>`): read-only picture across several ClickUp lists, one list = one project.
  - **Overview**: KPI tiles, project health table (Off track / At risk / On track with the reasons on hover), and a cross-project risk list (overdue, starting late, due within 7 days, undated, unassigned, missing description / DoD / priority).
  - **Roadmap**: one bar per project from first start to last due date, share done, milestones, today line; expand a project to see its tasks (top-level only, or with subtasks nested).
  - **Workload**: active tasks or estimated hours per day / week / month, stacked by project (plus how many projects run at once), or one project stacked by person.
  - **People**: person x period heatmap across all projects against a capacity, over capacity flagged.
- **Board workload strip**: the same workload measure for the current board, drawn under the gantt in step with its week columns.
- **Overdue cues**: overdue due dates shown in red on the board, plus an "Overdue" filter.
- **Settings**: which task warnings apply (missing description, missing Definition of Done with your own keywords, missing priority), the first day of the week and the working days, which statuses count as backlog and whether backlog tasks show on the board, in warnings, in portfolio health and in workload, plus the portfolio thresholds (due-soon window, red / amber shares).
- **Local persistence**: all data is stored in the browser's `localStorage`, no server-side database required.

## Tech stack

- React 18 + TypeScript + Vite
- [frappe-gantt](https://github.com/frappe/gantt), vendored locally under `src/lib/frappe-gantt/` with a handful of bug fixes and a milestone rendering extension
- nginx serving the static production build
- Docker for building and running (no Node/npm needed on the host)

## Getting started

This project has no Node.js/npm on the host — everything runs through Docker.

```bash
# build and start
docker compose up --build -d
```

The app will be available at [http://localhost:3000](http://localhost:3000).

### Running arbitrary npm/node commands

```bash
docker run --rm -v $(pwd):/work node:20-alpine sh -c "cd /work && <command>"
```

For example, to type-check without emitting output:

```bash
docker run --rm -v $(pwd):/work node:20-alpine sh -c "cd /work && npx tsc --noEmit"
```

Unit tests (vitest, pure modules under `src/lib/`):

```bash
docker run --rm -v $(pwd):/work node:20-alpine sh -c "cd /work && npm test"
```

## ClickUp integration

Sync is optional and configured entirely from the app UI:

1. "ClickUp" in the header: enter a personal ClickUp API token, press Load and pick the Workspace. That is the whole connection; the portfolio works with just this.
2. Open a list as a board from the board switcher next to `Board | Portfolio`: it lists the boards kept in this browser and every list of the workspace (with search). A list opened for the first time is pulled straight away; each board keeps its own local copy (tasks, pending deletions, sync log), so switching back is instant and unpushed edits stay. "+ New local board" makes a board without ClickUp, and "Link to ClickUp list…" links a local board to a list.
3. Use "↓ Pull" to copy the board's ClickUp list onto the board (ClickUp wins, nothing is written to ClickUp) and "↑ Push" to copy the board onto ClickUp (the board wins). If either would overwrite changes made on the other side, it first lists each conflict (field, parent or dependency) and lets you keep the board value, take ClickUp's, merge both (tags, assignees) or write your own (name, description). Pull still writes nothing to ClickUp: values you keep on the board go with the next Push.
4. Deleting a task that exists in ClickUp only removes it from the board and lists it under "🗑 pending deletions" in the header, where you can restore it. Pull leaves it off the board; Push asks about each one: delete it in ClickUp, keep it there (the next Pull brings it back), apply the same answer to all remaining ones, or cancel the push.
5. The summary next to the buttons opens the sync log: the last 20 pulls / pushes with every task and field that changed.

The token is stored in `localStorage`, which is convenient for a personal tool but readable by any script that runs on the page (e.g. via XSS) — keep that in mind before using it against a shared or sensitive workspace.

See `CLAUDE.md` for a detailed breakdown of the pull / push rules and field coverage.

### Portfolio

Open **Portfolio** in the header, then **Projects** to tick the ClickUp lists that make up the portfolio. They are fetched read only (GET requests, nothing is written back) and cached in `localStorage`; **Refresh** fetches them again. The list of the current board always uses the live board data, including unsynced edits, and **Board** in the overview opens any project as the board. Without a ClickUp connection the portfolio shows the current board only, and **Load demo data** fills it with sample projects for a look around.

Est. hours use the ClickUp time estimate, spread evenly over the task's working days (Mon-Fri) and split between its assignees. Tasks without an estimate are listed separately rather than guessed.

Subtasks: the task count only counts the subtasks of a parent, not the parent again; hours add every task's own estimate (ClickUp does not roll estimates up through the API). A task with subtasks is not flagged as undated or unassigned itself, and subtasks show their parent's name next to theirs in the risk list.

## Project structure

```
src/
  components/     UI components (task rows, popups, dialogs, pickers)
    portfolio/    Portfolio view: overview, roadmap, workload, people
  hooks/          useTasks (state + persistence), useBoards, useClickUpConfig, useWorkspaceTree, useSettings, usePortfolio, useHashRoute
  lib/
    frappe-gantt/ vendored Gantt chart library with local fixes
    boards.ts     boards kept in this browser, storage keys, migration from the single board
    dates.ts      calendar helpers shared by export and portfolio
    settings.ts   user settings model, defaults, backlog and DoD matching
    warnings.ts   task warnings (description, DoD, priority)
    portfolio.ts  task state (done / overdue / late start) and project health rules
    portfolioData.ts  multi-list fetch, cache, demo data
    workload.ts   workload per time bucket
    tree.ts       parent / subtask hierarchy: display order, moves, spans
    criticalPath.ts
    exportGantt.ts
    exportOutput.ts
    clickup.ts
    sync.ts
    deletions.ts  board deletes waiting for Push: record, restore, plan
  utils.ts
  types.ts
  App.tsx
```

## Known limitations

- No baseline tracking, so dependency *removals* don't propagate between the app and ClickUp — remove them on both sides manually.
- No automatic rate-limit backoff against the ClickUp API.
- No realtime sync, webhooks, or auto-polling — sync is manual, on demand.
- ClickUp's API cannot turn a subtask back into a top-level task, so the app keeps such a task under some parent; use "Convert to > Parent task" in ClickUp, then sync.
- Comments, attachments, time tracking, and progress percentage are not synced.
