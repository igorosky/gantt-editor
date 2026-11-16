# Known e2e flakes

## Drag after a Portfolio round trip turns into a left-edge resize

**Spec:** `tests/review.e2e.ts`, "drags before and after a visit to the portfolio are separate undo steps"

**Status:** cause found and fixed in the helpers (`barsGrown` in `tests/fixtures.ts`). The spec is also retried once in CI as a safety net (see "Retry in CI" below). The trace of the original failure was lost, so the link between that failure and the cause below is inferred from an identical, deterministic reproduction. It was not observed in the failing run itself.

### What was seen

Seen once on 2026-11-13. It was a local run with the CI config (`CI=true`), `E2E_WORKERS=2`, and the full suite running against the built container. The second drag (bar B, after Board, Portfolio, Board) failed this assertion after its 5 s poll:

```
expect.poll(() => rowDates(page, 'Beta')).toEqual(['11.03.2026', '15.03.2026'])

  - Expected
  + Received
    "11.03.2026",
  - "15.03.2026",
  + "13.03.2026",
```

The start moved by the dragged 2 days and the due date stayed put, so the drag acted as a **left-edge resize**: the mouse press landed on B's left resize handle, not on the bar body.

Frequency:

- This spec under full-suite load: 1 failure in 8 runs. Those were 1 run at 3 workers, 3 runs at 2 workers, and 4 more from `--repeat-each 4` at 2 workers.
- This spec alone: 0 failures in 40 runs (`--repeat-each 20` at 2 and at 3 workers).
- All other specs: no failures in the same runs.

The failing run's `trace.zip` was deleted by the next local run, which clears `test-results`.

### Cause

1. **frappe grows every bar from width 0 when a chart svg is new.** `src/lib/frappe-gantt/bar.js` `draw_bar` calls `animateSVG(this.$bar, 'width', 0, this.width)`. `svg_utils.js` `getAnimationElement` turns that into a SMIL `<animate attributeName="width">` with `begin="0.1s"`, `dur="0.4s"` and an ease-out spline.
2. **SMIL times run on the svg's own timeline, which starts when the `<svg>` element is created.** So the animation only plays on a new svg:
   - page load;
   - back from Portfolio (the board body unmounts in portfolio view, and `GanttPanel` builds a new `FrappeGantt` on return);
   - the chart coming back after the board went empty (`destroy()`, then a new instance).

   A `refresh()` reuses the svg, and by then the begin time is long past, so nothing animates.
3. **Rendered width after clicking Board** on an idle machine (one requestAnimationFrame sample every 3rd frame; B's `width` attribute is 100):

   | ms after the click | 56 to 152 | 200 | 248 | 296 | 344 | 392 | 440 | 488 | 536 | 584 on |
   |---|---|---|---|---|---|---|---|---|---|---|
   | rendered width (px) | 100 | 14 | 32 | 49 | 64 | 77 | 88 | 96 | 99 | 100 |

   Before `begin` the base value (full width) shows, so the drop to near 0 happens about 150 to 200 ms after the click.
4. **The resize handles are 3 px wide, centred on each bar edge** (`draw_resize_handles`, `handle_width = 3`). The `center()` helper presses the centre of the bar's bounding box. Once the rendered width is about 3 px or less, that centre lies on the left handle. frappe's mousedown then sets `is_resizing_left`, and the "drag" moves only the start.
5. **Why it is rare, and only under load:** the dangerous window is about 15 ms long, just after the animation begins. On an idle machine Playwright reads the box within a few ms of `waitFor()`, before the animation starts, so it sees the full width. Under load the read slips later, and once in a while it lands in that window.
6. **Why the test was exposed:** `seed()` ends with `settle()`, which took at least 300 ms, so the growth after page load was mostly over by then. After the Portfolio round trip the spec measured B right after `waitFor()`. `settle()` only watched the scroll position anyway, never the bar width.

### Deterministic reproduction

Freeze the new svg at the start of the animation, measure, then let it run again:

```ts
await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Portfolio' }).click()
await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Board' }).click()
await page.locator('.bar-wrapper[data-id="B"]').waitFor()
await page.evaluate(() => {
  const s = document.querySelector('svg.gantt') as SVGSVGElement
  s.pauseAnimations()
  s.setCurrentTime(0.1)
})
const c = await center(page, '.bar-wrapper[data-id="B"] .bar')
await page.evaluate(() => (document.querySelector('svg.gantt') as SVGSVGElement).unpauseAnimations())
await dragBy(page, c.x, c.y, 40)
await expect.poll(() => rowDates(page, 'Beta')).toEqual(['11.03.2026', '15.03.2026'])
```

- **Helpers from before the fix:** the measured box width is 0, and the spec fails 3 out of 3 times with the exact symptom above (`"13.03.2026"` as the due date).
- **Fixed helpers** (with `setCurrentTime(0.1)` but without the pause, since `barsGrown` would otherwise wait forever): the measured width is 100, and it passes 3 out of 3 times.

### Fix

`tests/fixtures.ts` `barsGrown(page)` waits until `document.querySelector('svg.gantt').getCurrentTime() >= 0.55` (begin 0.1 s + 0.4 s, plus a margin). Both `center()` and `settle()` call it, so every press through `center`, `clickBar` or `dragBy` waits for the growth. That includes the "after clearing every task the chart comes back" spec, which also gets a new svg.

Not affected:

- Resize handle and connect-dot boxes: they are drawn at the final width.
- `.gantt-container` boxes.
- The direct `.bar` `boundingBox()` reads in `zoom.e2e.ts` and `selection.e2e.ts`: they run after `seed()`, whose `settle()` now waits too.

**New code should measure bars through `center()`.**

After the fix: full suite 84/84 at the default 3 workers, with the Playwright container limited to 2 CPUs (`--cpus=2`, about a 2-vCPU GitHub runner).

The app itself was left alone. A real user would only notice this by pressing a bar within half a second of a chart rebuild. Dropping the `animateSVG` call in `bar.js` would remove the growth if that is ever wanted.

### Retry in CI

The spec sits in an anonymous `test.describe` (title unchanged) with `test.describe.configure({ retries: process.env.CI ? 1 : 0 })`.

- **Locally:** no retry, so a local failure still shows up as a failure.
- **In CI**, verified with a probe that fails its first attempt only:
  - the job stays green;
  - the summary says `1 flaky`;
  - the `github` reporter adds an `::error` annotation for the failed attempt;
  - that attempt's `trace.zip` stays in `test-results`.
- The workflow's "Upload traces of retried tests" step then uploads it as the **`e2e-flaky-traces`** artifact (14 days). A clean run uploads nothing.

### If it shows up again

1. Download `e2e-flaky-traces` (or `e2e-results` from a failed run) and open the trace: `npx playwright show-trace trace.zip`, or drop the file on trace.playwright.dev.
2. In the before-snapshot of the drag's `mouse.down`, look at the width of `.bar-wrapper[data-id="B"] .bar`.
   - **Near 0:** the growth again. Check whether the svg was replaced after `barsGrown` returned, for example a second chart init.
   - **Full width:** a different cause. Usual suspects are a gantt refresh during the interaction (an effect dep that changes identity on every render) or an overlay taking the press. Check `document.elementFromPoint` at the press point.
3. Once CI has run about 20 times without an `e2e-flaky-traces` artifact for this spec, the retry wrapper can go.
