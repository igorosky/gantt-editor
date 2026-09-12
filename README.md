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

## ClickUp integration

Sync is optional and configured entirely from the app UI (the "ClickUp" button in the header):

1. Enter a personal ClickUp API token.
2. Pick a Workspace, then a Space, then a Folder (or "folderless"), then a List.
3. Use "Sync now" to pull/push tasks between the app and that ClickUp list.

The token is stored in `localStorage`, which is convenient for a personal tool but readable by any script that runs on the page (e.g. via XSS) — keep that in mind before using it against a shared or sensitive workspace.

See `CLAUDE.md` for a detailed breakdown of the sync engine's conflict resolution rules and field coverage.

## Project structure

```
src/
  components/     UI components (task rows, popups, dialogs, pickers)
  hooks/          useTasks (state + persistence), useClickUpConfig
  lib/
    frappe-gantt/ vendored Gantt chart library with local fixes
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
