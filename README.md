# Gantt Editor

> **Note:** This app is fully vibe coded. It was built through iterative conversation with an AI assistant rather than hand-designed up front, so expect some rough edges, historical quirks, and inconsistent styling in places. It works, but treat the code as exploratory rather than production-grade.

A browser-based Gantt chart editor with two-way ClickUp sync, dependency tracking, critical path highlighting, and export to PNG/PDF. No backend — everything runs client-side.

## Features

- **Split-panel editor**: task list on the left, Gantt chart on the right, resizable divider between them.
- **Dateless tasks**: tasks can exist without start/end dates and still show up in the list.
- **Milestones**: zero-duration markers (diamond glyph) alongside regular date-ranged tasks.
- **Dependencies**: click-to-connect arrows between tasks, with drag/resize propagation to successors.
- **Critical path**: toggle highlighting of the longest duration-weighted dependency chain, scoped to the whole project or just the current view.
- **Task detail popup**: status, priority, assignees, tags, description, and dependency editing in one place.
- **Export**: redraw the chart as a PNG or a paginated/print-ready PDF, independent of what's currently scrolled into view.
- **ClickUp sync**: manual two-way sync of tasks, dates, dependencies, priority, description, assignees, status, tags, and task type against a ClickUp list.
- **Portfolio view** (header switch `Board | Portfolio`, bookmarkable at `#/portfolio/<tab>`): read-only picture across several ClickUp lists, one list = one project.
  - **Overview**: KPI tiles, project health table (Off track / At risk / On track with the reasons on hover), and a cross-project risk list (overdue, starting late, due within 7 days, undated, unassigned, missing DoD).
  - **Roadmap**: one bar per project from first start to last due date, share done, milestones, today line; expand a project to see its tasks.
  - **Workload**: active tasks or estimated hours per day / week / month, stacked by project (plus how many projects run at once), or one project stacked by person.
  - **People**: person x period heatmap across all projects against a capacity, over capacity flagged.
- **Board workload strip**: the same workload measure for the current board, drawn under the gantt in step with its week columns.
- **Overdue cues**: overdue due dates shown in red on the board, plus an "Overdue" filter.
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

Sync is optional and configured entirely from the app UI (the "ClickUp" button in the header):

1. Enter a personal ClickUp API token.
2. Pick a Workspace, then a Space, then a Folder (or "folderless"), then a List.
3. Use "Sync now" to pull/push tasks between the app and that ClickUp list.

The token is stored in `localStorage`, which is convenient for a personal tool but readable by any script that runs on the page (e.g. via XSS) — keep that in mind before using it against a shared or sensitive workspace.

See `CLAUDE.md` for a detailed breakdown of the sync engine's conflict resolution rules and field coverage.

### Portfolio

Open **Portfolio** in the header, then **Projects** to tick the ClickUp lists that make up the portfolio. They are fetched read only (GET requests, nothing is written back) and cached in `localStorage`; **Refresh** fetches them again. The list connected to the board always uses the live board data, including unsynced edits. Without a ClickUp connection the portfolio shows the current board only, and **Load demo data** fills it with sample projects for a look around.

Est. hours use the ClickUp time estimate, spread evenly over the task's working days (Mon-Fri) and split between its assignees. Tasks without an estimate are listed separately rather than guessed.

## Project structure

```
src/
  components/     UI components (task rows, popups, dialogs, pickers)
    portfolio/    Portfolio view: overview, roadmap, workload, people
  hooks/          useTasks (state + persistence), useClickUpConfig, usePortfolio, useHashRoute
  lib/
    frappe-gantt/ vendored Gantt chart library with local fixes
    dates.ts      calendar helpers shared by export and portfolio
    portfolio.ts  task state (done / overdue / late start) and project health rules
    portfolioData.ts  multi-list fetch, cache, demo data
    workload.ts   workload per time bucket
    criticalPath.ts
    exportGantt.ts
    exportOutput.ts
    clickup.ts
    sync.ts
  utils.ts
  types.ts
  App.tsx
```

## Known limitations

- No baseline tracking, so dependency *removals* don't propagate between the app and ClickUp — remove them on both sides manually.
- Local task deletion does not delete the corresponding ClickUp task.
- No automatic rate-limit backoff against the ClickUp API.
- No realtime sync, webhooks, or auto-polling — sync is manual, on demand.
- Subtasks, comments, attachments, time tracking, and progress percentage are not synced.
