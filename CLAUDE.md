# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Key constraint: no npm on the host

No Node.js/npm on host. All build/install commands run inside Docker:

```bash
# Build and start (primary workflow)
docker compose up --build -d

# Run arbitrary npm/node commands
docker run --rm -v /home/igor/gantt-editor2:/work node:20-alpine sh -c "cd /work && <command>"

# Example: add a package
docker run --rm -v /home/igor/gantt-editor2:/work node:20-alpine sh -c "cd /work && npm install <pkg>"

# Type-check only (no emit)
docker run --rm -v /home/igor/gantt-editor2:/work node:20-alpine sh -c "cd /work && npx tsc --noEmit"

# Unit tests (vitest; pure modules in src/lib/*.test.ts). The script pins
# TZ=Europe/Warsaw so the DST cases in the date / workload tests are real.
docker run --rm -v /home/igor/gantt-editor2:/work node:20-alpine sh -c "cd /work && npm test"
```

App served at **http://localhost:3000**.

## Architecture

React 18 + TypeScript + Vite frontend, static files via nginx, multi-stage Docker build.

**Split-panel layout** (`App.tsx`): left panel (task list) + right panel (Gantt chart) split by draggable `Divider`. Panel widths stored as percentage (15–70%).

**Views** (`src/hooks/useHashRoute.ts`): header switch `Board | Portfolio`, hash routed (`#/` board, `#/portfolio/{overview|roadmap|workload|people}`), no router dependency. The board body (TaskPanel / GanttPanel / strip) unmounts in portfolio view; on return GanttPanel re-inits and re-wires scroll sync through `onContainerReady`.

**Core types** (`src/types.ts`): `GanttTask` has `id`, `name`, `type?: 'task' | 'milestone'` (absent means task — see Milestones section), `start?: Date`, `end?: Date` (both optional — a task without dates is valid and shown only in the left panel), `progress: number` (in data model, not shown in chart), `dependencies?: string[]` (predecessor *local* ids), `clickupId?: string` (set when task linked to ClickUp), and ClickUp-synced optional fields: `status?: string`, `priority?: 1|2|3|4`, `assignees?: Assignee[]`, `tags?: Tag[]`, `description?: string`. Pull-only from ClickUp (never pushed): `statusType?: string` (`status.type`: open / custom / closed / done) and `timeEstimate?: number` (ms). `Assignee` is `{ id: number; username: string }` — stores ClickUp user ID (needed to push assignee changes via API). Migrated tasks from old `string[]` format get `id: -1` as sentinel; those are display-only and excluded from ClickUp pushes. `Tag` is `{ name: string; tag_bg?: string; tag_fg?: string }`.

**State and persistence** (`src/hooks/useTasks.ts`): all tasks in single `useState` array, persisted to `localStorage` under key `'gantt-tasks'`. First load creates example task. `updateTask` uses functional `setState` form so sequential calls compose correctly (React 18 batches). `deserialize` runs a migration on load: if `assignees` entries are strings (old format), they're wrapped as `{ id: -1, username }`; absent `start`/`end` fields deserialize to `undefined` (not Invalid Date).

**Gantt library** (`src/lib/frappe-gantt/`): frappe-gantt vendored locally (not npm) for free modification. Vite alias `frappe-gantt` → `src/lib/frappe-gantt/index.js` keeps imports unchanged. `@types/frappe-gantt` stays in devDependencies for types.

Local fork changes:
- `get_all_dependent_tasks()` BFS — original prematurely added nodes to `out` before computing `to_process`, limiting traversal to one level. Fixed with `Set`-based BFS.
- `bind_bar_events` — dependents included in drag group during resize. Fixed: only include dependents when `is_dragging` true.
- `_placeholder` task support (see Dateless tasks section below).
- `milestone.js` (new file) + `make_bars` dispatch on `_milestone` (see Milestones section below).
- `Bar.refresh()` rewrites the group's `class` attribute wholesale instead of `classList.add(custom_class)`. The original threw `InvalidCharacterError` on a multi-token `custom_class` (`'milestone critical'`) and never dropped a token removed since the last refresh.

**Alignment constants** (`src/constants.ts`): frappe-gantt row/header geometry hardcoded in library. `GANTT_ROW_HEIGHT` (48px) and `GANTT_HEADER_HEIGHT` (85px) must stay in sync with frappe-gantt defaults. LHS `TaskPanel` header height = `GANTT_HEADER_HEIGHT + GANTT_TOOLBAR_HEIGHT` to account for toolbar above gantt.

**Scroll sync** (`App.tsx` `handleContainerReady`): bidirectional scroll sync between `.gantt-container` div (RHS) and task list div (LHS) via event listeners guarded by `isSyncingRef` to prevent feedback loops. Sync is pixel-based (`scrollTop`), so both panels must always have the same number of rows — enforced by placeholder rows (see below).

**Dependency propagation** (`src/utils.ts`, `GanttPanel.tsx`, `App.tsx`):
- `getAllSuccessors(taskId, tasks)` — shared BFS, returns all transitive successors.
- `GanttPanel` `on_date_change`: distinguishes drag vs resize via ±2s heuristic on `durationDelta` (frappe-gantt applies −1s adjustment to end dates). Drag → propagates `startDelta`; right-edge resize → propagates `durationDelta`; left-edge resize → propagates nothing. Guards skip successors with undefined dates.
- `App.handleTaskUpdate`: LHS end date change propagates end delta to all transitive successors. Guards skip tasks with undefined dates.

**Connect mode** (`GanttPanel.tsx`): click-to-connect for creating/removing dependency arrows. Uses `ganttClickRef` reassigned every render so frappe-gantt's `on_click` always has fresh closure. `connectModeRef`/`connectSourceRef` are refs (not state) for frappe-gantt callbacks; `connectMode`/`connectSource` are state for React re-renders. Escape cancels connect mode.

**Refresh without scroll reset** (`GanttPanel.tsx`): every `gantt.refresh()` saves and restores `.gantt-container` scroll position to prevent jumping on React re-renders.

**Chart height** (`GanttPanel.tsx`): frappe-gantt's container height is set at init; a `ResizeObserver` on `.gantt-panel__chart` keeps `$container.style.height` and `options.container_height` matching the panel afterwards (window resize, workload strip toggled).

**Board workload strip** (`components/WorkloadStrip.tsx`): "▤ Workload" in the gantt topbar, persisted to `localStorage['gantt-load-strip']` as `{ on, metric }`. Mounted in `App.tsx` *below `app__body`, full width*, so both panels lose the same height and the pixel scroll sync stays aligned. Buckets are frappe-gantt's own columns: `GanttPanel` reports `{ dates: gantt.dates, columnWidth }` via `onGeometry` after init / refresh and on container scroll (infinite padding re-renders with more columns from inside frappe's wheel handler); the strip measures the `.gantt-container` rect to line up its plot and mirrors `scrollLeft` with a CSS transform (no re-render). Uses `filteredTasks`, so it follows the filters.

**TaskRow** (`components/TaskRow.tsx`): inline name editing (click to edit, Enter/Blur to commit, Escape to cancel). Overdue tasks (`isOverdue` from `lib/portfolio.ts`) get `.task-row--overdue`: the due date (always the last date field) turns red and its title says how many days late. FilterBar has a matching `overdue` filter type. Date inputs show empty when date is undefined; clearing the text field (blur on empty) sets the date to `undefined`. Clamping (start > end prevention) only runs when both dates are defined. Row height fixed to `GANTT_ROW_HEIGHT` for gantt alignment. `⤢` icon button (visible on hover) opens `TaskDetailPopup`.

**TaskDetailPopup** (`components/TaskDetailPopup.tsx`): centered modal opened from the `⤢` button on each task row. State in `App.tsx` (`detailTaskId`). Shows: task ID badge, status selector (editable when ClickUp configured), ↗ link to ClickUp if `clickupId` set, priority pill dropdown (1=Urgent/2=High/3=Normal/4=Low), editable name, assignee chips with `×` remove + `+ Add` button (when ClickUp configured), tag chips with `×` remove + `+ Add tag` button (when ClickUp space configured), date pickers (empty when undefined; clearing sets to undefined), dependency chips with `×` remove, description textarea. Days display only shown when both dates are defined.

**StatusSelector** (inline component in `TaskDetailPopup.tsx`): colored badge in the topbar that opens a dropdown of list statuses when ClickUp token + listId are configured. Fetches available statuses via `getListStatuses` on first open and caches them for the popup's lifetime. Picking a status patches `status`, `statusColor` and `statusType` together.

**AssigneePicker** (`components/AssigneePicker.tsx`): floating dropdown rendered inside the assignees row of `TaskDetailPopup`. Fetches workspace members via `listTeamMembers` on first open (cached in component state for the popup's lifetime). Fuzzy-filters by username+email substring.

**TagPicker** (`components/TagPicker.tsx`): floating dropdown in `TaskDetailPopup`. Fetches space tags via `getSpaceTags` on first open. Shows existing tags with toggle checkmarks; supports creating new tags inline. Only visible when ClickUp token + spaceId are configured.

**CSS** (`src/App.css`): CSS custom properties defined in `:root` at top of file — `--accent`, `--border`, `--surface-*`, `--text-*`, `--radius-*`, `--shadow-*`. All popup styles use these vars. Existing non-popup styles use hardcoded colors for historical reasons.

## Dateless tasks

Tasks without `start`/`end` are valid and appear in the left panel like any other task, but are not rendered as bars in the Gantt chart. Dependency arrows involving a dateless task also do not appear.

**Scroll sync preservation**: frappe-gantt must always render exactly N rows (one per task, in order) for the pixel-based scroll sync to stay aligned. To achieve this, `GanttPanel` passes ALL tasks to frappe-gantt, marking dateless tasks with `_placeholder: true`. The vendored frappe-gantt handles `_placeholder` tasks as follows:
- `setup_tasks`: placeholder tasks skip date validation; `_start`/`_end` are set to `new Date()` (dummy, never used for display)
- `setup_gantt_dates`: placeholder tasks are skipped when computing the visible date range; if all tasks are placeholders, falls back to today
- `make_bars`: bar group for placeholder tasks gets `visibility:hidden; pointer-events:none`
- `make_arrows`: arrows are skipped when either endpoint task has `_placeholder: true`

## Milestones

`type: 'milestone'` marks a zero-duration task (ClickUp custom task type id 1). A milestone keeps **one date in both `start` and `end`**; every writer keeps them equal. A dateless milestone is legal and follows the `_placeholder` path above.

- **Conversion** (`src/utils.ts`): `isMilestone(t)` and `typeChangePatch(t, next)`. Task → milestone keeps the **due date** (`end ?? start`); milestone → task leaves a one-day task.
- **UI**: `TypePill` in `TaskDetailPopup`'s hero (also the create path — the "+ Add task" draft popup); `TaskRow` shows a `◆` glyph and a single date picker, with a hidden `.task-row__date-ghost` stand-in so the date stays in the due-date column.
- **Rendering**: `GanttPanel` maps a dated milestone with `_milestone: true` and `custom_class: 'milestone'`. `make_bars` builds a `Milestone` (`src/lib/frappe-gantt/milestone.js`) instead of a `Bar`. `$bar` stays a `<rect>` (arrows, drag cache and `compute_start_end_date` read x/y/width/height attributes) sized `28 / √2` square, centred on the day cell; CSS rotates it 45° with `transform-box: fill-box` so no JS maintains a transform during drags. The subclass also drops the resize handles (and stubs `update_handle_position`, which the base dereferences unguarded every drag frame), pins `duration` to one day, and reports `date_change` with the same date twice instead of end − 1s.
- **Colors**: `--g-milestone-color` (gantt `styles/themes.css`, light + dark) and `--milestone` (`src/App.css`, used by the left-panel glyph and the popup pill).

## Critical path

`src/lib/criticalPath.ts` — `computeCriticalPath(tasks)` returns `{ taskIds: Set<string>, edges: Set<string> }`, edges keyed `` `${predecessorId}->${successorId}` `` by the exported `edgeKey`. `EMPTY_CRITICAL` is a module const so the empty case keeps a stable identity for `useMemo` / effect dep arrays.

**Definition: longest dependency chain**, weighted by task duration, gaps between bars ignored. *Not* zero-slack CPM — dates here are hand-set, so a slack rule would drop tasks from the chain merely because the user left room between two bars. Duration is inclusive days (`end − start + 1`), milestones count 0. Only tasks with both dates are nodes; a dateless task breaks the chain, matching the fact that it has no bar and no arrows.

Two memoized walks: `chainTo` (longest chain ending at a node, over predecessors) and `chainFrom` (longest chain starting at it, over successors, using an inverted index — not `getAllSuccessors`). `maxTotal` is the max of `chainTo` over nodes that *have* a predecessor, so a lone long task is never reported as the path. A node is critical when `chainTo + chainFrom − duration === maxTotal`; an edge is critical when both ends are and `chainTo(from) + chainFrom(to) === maxTotal`. Tied chains are all kept. Both walks are cycle-safe (a back edge inside an in-progress walk contributes 0); a pure cycle yields the empty result rather than hanging.

**Two toggles**, both persisted to `localStorage['gantt-critical']` as `{ on, scope }`, state in `App.tsx`, controls rendered in the `GanttPanel` topbar: on/off, plus scope `'project'` (compute over all `tasks`) vs `'view'` (over `filteredTasks`). `ExportDialog` has its own equivalent pair in `localStorage['gantt-export-opts']` (`highlightCritical`, `critScope: 'project' | 'export'`).

**Styling is red outline, fill preserved**, so ClickUp status colors survive. Live chart: `GanttPanel` appends a `critical` token to `custom_class` (hence the `Bar.refresh()` fork fix above) and `App.css` strokes `.bar-wrapper.critical .bar` with `!important`, since gantt.css pins `stroke-width: 0`. Arrows carry no class, so `applyCriticalArrows()` re-marks `path[data-from][data-to]` after every init/refresh — arrows are rebuilt each refresh. Left panel gets `.task-row--critical` (inset box-shadow, so row height stays 48px). Color lives in `--critical` (`App.css`) and `C.critical` (`exportGantt.ts`), which must stay in sync.

Export: `ExportOptions.criticalIds` / `.criticalEdges` are precomputed by `ExportDialog` over the **whole** selection and passed down — never computed inside `buildGanttSvg`, which receives row slices per page and would otherwise produce a different path on every page.

## Export to PNG / PDF

"Export" button in the app header opens `ExportDialog`. The exported picture is **redrawn from the task array**, never screenshotted from the live chart — the on-screen gantt mixes SVG bars with absolutely positioned HTML header divs and is clipped by `.gantt-container`'s scroll box. No new dependencies.

**Renderer** (`src/lib/exportGantt.ts`): `buildGanttSvg(tasks, opts)` is pure, returns `{ body, width, height }`; `svgDocument(built, size?)` wraps it in an `<svg>` root. Left columns (`COLUMNS`/`COLUMN_ORDER`, `name` always present) then a timeline: two-band date header, unit grid, weekend shading (day view), bars/milestone diamonds, dependency arrows, today marker.
- **Self-contained by necessity**: colors are hardcoded literals (copied from `src/App.css` `:root` and gantt `themes.css`) and the font is `Helvetica, Arial, sans-serif`. Once the SVG is detached from the document — or loaded through `<img>` for rasterization — `var()` cannot resolve and external fonts cannot load. The root always carries explicit `width`/`height`; Firefox has no intrinsic size otherwise.
- **Time mapping** is one linear `pxPerDay` scale, but grid lines are drawn at *real* unit boundaries, so month columns are naturally 28–31 days wide with no drift. `daysBetween` rounds so DST never shifts a day. The calendar helpers (`startOfDay`, `addDays`, `daysBetween`, `startOfWeek`, `unitStarts`, `autoUnit`, ...) live in `src/lib/dates.ts`; `exportGantt.ts` re-exports the ones it used to export.
- Bars are clamped to the window; a clipped edge gets a white chevron so truncation is visible. Dateless rows render their LHS cells plus a muted `no dates` label.
- Arrows are ported from `src/lib/frappe-gantt/arrow.js:13-89` with export geometry substituted for `gantt.options.padding` / `header_height`.
- SVG has no text-overflow: `fitText` truncates with a real ellipsis, measuring through a module-level canvas 2D context.

**Output** (`src/lib/exportOutput.ts`):
- PNG — SVG → blob URL → `<img>` → canvas → `toBlob`. `effectiveScale` steps the requested 1x/2x/3x down when it would exceed the browser canvas dimension/area caps.
- PDF — no PDF library. `printPages` writes an off-screen iframe with `@page` sized to the chosen paper and calls `print()`; the user picks "Save as PDF" (vector, selectable text).
- `buildPages` splits row-outer / date-inner. Vertical slices come from rows-per-page, horizontal slices from `dateSlices` (greedy, cut on unit boundaries). Each page is a fresh `buildGanttSvg` call on a row+date subset, so the header band and LHS columns repeat for free. With `multipage` off, one page is emitted and the print CSS scales it to fit (`preserveAspectRatio="xMinYMin meet"`, never upscaled).

**Dialog** (`src/components/ExportDialog.tsx`): format, task scope (visible / all / manual pick), dateless toggle, time period (fit / custom via the existing `DatePicker`), left columns, unit (auto/day/week/month), arrows + today + critical path (with its own project/exported scope) + title, then paper/orientation/`Allow multiple pages` (PDF) or scale (PNG). Live preview re-runs the pure builder in a `useMemo`. Options persist to `localStorage['gantt-export-opts']` (dates and manual picks excluded).

## ClickUp two-way sync

App talks to ClickUp REST API directly from browser. No backend — all sync logic client-side.

**Network path**: nginx proxies `/clickup/*` → `https://api.clickup.com/api/v2/*` (`nginx.conf` `location /clickup/` block). `resolver` directive required for nginx-alpine to resolve `api.clickup.com` at runtime; `proxy_ssl_server_name on` required for SNI. `vite.config.ts` mirrors proxy under `server.proxy` for parity in `vite dev`. Personal API tokens (`pk_*`) sent in `Authorization` header verbatim, no `Bearer ` prefix (OAuth would need it; not used).

**Config** (`src/hooks/useClickUpConfig.ts`): `ClickUpConfig` (`token`, `teamId`, `spaceId`, `folder`, `listId`, optional `lastSyncAt`) persisted to `localStorage['clickup-config']`. `folder` is real folder id or literal `'folderless'` for spaces with lists directly under space. Token in localStorage — acceptable for personal tool but readable by XSS (noted in `ClickUpSettings.tsx`).

**Settings UI** (`components/ClickUpSettings.tsx`): cascading dropdowns Workspace → Space → Folder → List. Token entry has explicit "Load" button to avoid firing requests on every keystroke. Mounted from "ClickUp" button in `App.tsx` header.

**API client** (`src/lib/clickup.ts`): pure functions over `fetch('/clickup/...')`. Tokens passed as first arg; nothing module-scoped. Throws `ClickUpError` (status + body) on non-2xx. `toClickUpDate`/`fromClickUpDate` translate between JS `Date` and ClickUp's "ms since epoch as STRING"; `fromClickUpDate` returns `Date | null`. `getAllTasks` paginates until page returns < 100 tasks. `CreateTaskBody` omits date fields entirely when a task has no dates; `UpdateTaskBody` accepts `start_date?: string | null` and `due_date?: string | null` — sending `null` clears the date in ClickUp. `listTeamMembers` fetches via `GET /team` (not `/team/{id}/member` — that endpoint doesn't exist). `getListStatuses(token, listId)` returns `ClickUpStatus[]` (`{ status, color, orderindex }`). `addTagToTask`/`removeTagFromTask` use `POST /task/{id}/tag/{name}` and `DELETE /task/{id}/tag/{name}`.

**Remote -> local mapping** (`src/lib/sync.ts`, `mapRemoteTask(r, id)`): the one place a `RemoteTask` becomes a `GanttTask` (milestone collapse, priority, status + status type, estimate). Used by sync Phase 4 and by the portfolio fetch. Dependencies are left to the caller.

**Sync engine** (`src/lib/sync.ts`, `syncWithClickUp`): six phases on manual "Sync now". (1) Fetch all remote tasks — fatal on failure. (2) Each linked local task with remote match: compare `r.date_updated` to `config.lastSyncAt` — remote changed since last sync → ClickUp wins, overwrite local fields; `start`/`end` set to `remoteDate ?? undefined` (a null remote date clears the local date — no arbitrary fallback). Local-wins branch pushes via PUT, sending `null` for dates to clear them in ClickUp if local is undefined. (3) Create remote tasks for local-only rows; date fields omitted from create body when undefined. (4) Synthesize local rows for remote-only tasks — `start`/`end` set to `fromClickUpDate(...) ?? undefined`; no arbitrary today/+7days defaults. (5) Dependencies additive union: local-not-remote edges POSTed up, remote-not-local added locally. (6) Bulk `setTasks(next)` — single render. Caller (`App.tsx` `onSync`) updates `lastSyncAt`.

`sameDay(a, b)` in sync.ts accepts `Date | null | undefined` on both sides; treats null and undefined as equivalent (both mean "no date").

**Conflict policy**: ClickUp wins only when its `date_updated` postdates last sync; otherwise local propagates up.

**Pull-only fields**: `statusType` and `timeEstimate` follow ClickUp on every sync. In the local-wins branch `timeEstimate` is still refreshed, and `statusType` only while the local status name equals the remote one (a local status change carries its own type from StatusSelector).

**Synced fields**: `name`, `start`/`end` dates (optional; null/undefined preserved), `dependencies`, `priority` (push+pull; ClickUp int 1–4), `description` (push+pull), `assignees` (push+pull; push sends `{ add: [...ids], rem: [...ids] }` diff; sentinel id `-1` excluded), `status` (push+pull), `tags` (push+pull; per-tag add/remove via tag name), `type` (push+pull via `custom_item_id`; `MILESTONE_ITEM_ID = 1` in `clickup.ts`). `custom_item_id` is only sent when the type actually flips, so other custom task types in the workspace are never overwritten; a remote milestone collapses `start`/`end` onto its due date. Milestone pushes fail if the space has the Milestones ClickApp disabled — the error lands in `report.errors`.

**v1 limitations**: no baseline tracking → dependency *removals* don't propagate either direction (remove on both sides manually); local delete does not delete remote (`deleteTask` intentionally unexposed); no rate-limit backoff (ClickUp free tier ~100 req/min — surface 429s, retry manually); no realtime/webhook/auto-poll. Subtasks, comments, attachments, time tracking, `progress` not synced.

**Hook contract** (`src/hooks/useTasks.ts`): raw `useState` setter exposed as `setTasks` so `syncWithClickUp` does single bulk replacement. Persistence `useEffect` watches `tasks`, writes `localStorage['gantt-tasks']`; bulk replacement round-trips through JSON serialize/deserialize cleanly (dates → ISO string → Date; undefined dates → field absent in JSON → undefined on deserialize).

## Portfolio (multi-project, read only)

Directors' view over several ClickUp lists; **one list = one project**. Nothing in it writes to ClickUp: the fetch only issues GETs, and editing stays on the board.

**Data** (`src/lib/portfolioData.ts`): `ProjectRef { listId, name, folderName?, spaceName? }`, `PortfolioTask = GanttTask & { projectId, warningIds }`, `PortfolioProject { ref, color, tasks, isCurrentBoard, fetchedAt?, error? }`. `toPortfolioTask` = `mapRemoteTask(r, r.id)` + `warningIds` from `getTaskWarnings`, then `description` is dropped to keep the cache small (so warnings must be precomputed, never derived from cached tasks). `fetchProjects(token, listIds, onProgress)` runs `getAllTasks` with a pool of 3; a failing list (429 included) yields its own `error` and never aborts the others. `demoProjects(today)` is a synthetic red / amber / green / done portfolio with one person over capacity this week, used by the in-memory "Load demo data" button and by tests.

**Colors**: `PROJECT_COLORS` is a fixed, CVD-validated categorical order (dataviz reference palette); a project's slot is its position in the picked list, so a color follows the project, never its rank. Past eight projects use `OTHER_COLOR` and fold into "Other" in stacked charts. Status colors (good `#0ca30c`, warning `#fab219`, critical `#d03b3b`, as `--pf-*` vars in `Portfolio.css`) are reserved for state and always paired with an icon / label.

**State** (`src/hooks/usePortfolio.ts`, called in `App.tsx` so it survives view switches): `localStorage['portfolio-config'] = { refs, hidden }` and `localStorage['portfolio-cache'] = { [listId]: { fetchedAt?, error?, tasks } }` (quota failure -> kept in memory, notice shown). The list linked to the board (`config.listId`) is never fetched: it is replaced by the live board tasks, unsynced edits included. No refs picked -> the board alone as "Current board" (also the no-ClickUp case). `missing` = picked lists with no cache entry; `PortfolioView` auto-fetches those. A failed refresh keeps the last good tasks with the error attached.

**Rules** (`src/lib/portfolio.ts`, pure, every date function takes `today`):
- `isDone`: `statusType` closed / done; without a type, status-name regex fallback.
- `isOverdue`: open, `end` before today. `isLateStart`: open, not a milestone, `start` before today, still in initial status (`statusType === 'open'`, or a to-do-like name). `isDueSoon`: due today .. +7 days.
- RAG (`projectHealth`, thresholds are constants at the top): **red** = an overdue milestone, or project end passed with open tasks, or >= 20% of open tasks overdue; **amber** = any overdue / late start, or >= 25% of open tasks undated; else **green**; no open tasks = **done**. `ragReasons` feed the pill tooltip.
- `riskItems`: open tasks with any risk kind, worst kind first, then days late.

**Workload** (`src/lib/workload.ts`, `computeWorkload(tasks, boundaries, { metric, keysOf, includeDone })`): buckets come as n + 1 boundaries, so the portfolio (`unitBoundaries`) and the board strip (frappe columns) share one engine. Milestones skipped; undated -> `skippedUndated`; done excluded unless `includeDone`. `count`: +1 per key in every overlapped bucket. `hours`: `timeEstimate` spread evenly over the task's Mon-Fri days (all days for a weekend-only task), split evenly across keys; no estimate -> `missingEstimate`, contributes 0. `items` per bucket drive the click drill-downs. Portfolio callers pass project-qualified ids (`${projectId}:${id}`) because ids are only unique within a list.

**Views** (`src/components/portfolio/`, styles in `Portfolio.css`):
- `PortfolioView`: tabs, Projects picker / Refresh / fetched stamp, per-project visibility chips, banners (no ClickUp, nothing picked, quota, per-list errors). `today` is fixed per mount so every tab agrees.
- `OverviewTab`: KPI tiles, sortable health table (row click filters the risk list), risk list with kind chips (default overdue / late start / due soon), capped at 200 rows.
- `RoadmapTab`: single scroll box, sticky header row + sticky LHS; project bar = `projectSpan`, done share as darker fill, red outline when RAG red, milestone diamonds, today line; rows expand into dated tasks + an undated count.
- `WorkloadTab`: metric / unit / scope (all projects stacked by project with a "Projects" active-count band, or one project stacked by person, top 7 + Other) / range presets / include done. `StackedBarChart` is hand-written SVG (bars <= 24px, 4px rounded data end, 2px surface gap between segments, hit target = whole slot).
- `PeopleTab`: person x bucket heatmap over all visible projects; sequential blue ramp by share of capacity, critical + "!" when over (hours: capacity h/day x workdays in bucket; count: max tasks per period). Unassigned row last, neutral.
- `ProjectPicker`: Space > Folder > List tree with search (`listSpaces`, `listFolders` (its response embeds `lists`), `listFolderlessLists`); saving keeps the existing order and appends new picks, since order decides color.

