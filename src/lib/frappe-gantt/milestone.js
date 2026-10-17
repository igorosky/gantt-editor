import Bar from './bar';
import date_utils from './date_utils';
import { createSVG } from './svg_utils';

// Local addition (not upstream frappe-gantt): a zero-duration task rendered as
// a diamond instead of a bar.
//
// The diamond is $bar itself — a square <rect> rotated 45deg in CSS
// (.bar-wrapper.milestone .bar). Keeping $bar a rect matters: arrows, the drag
// cache and compute_start_end_date all read x/y/width/height attributes via the
// SVGElement helpers installed in Bar.prepare_helpers, which a <path> would not
// expose. CSS transform-box:fill-box keeps the rotation centred on the rect as
// x changes during a drag, so no JS has to maintain a transform.

// Visual size of the diamond; the underlying square is smaller by sqrt(2).
const DIAMOND_SIZE = 28;
const SIDE = Math.round(DIAMOND_SIZE / Math.SQRT2);

export default class Milestone extends Bar {
    // Width one day occupies in the current view mode. Independent of
    // this.duration, which collapses to zero once start === end.
    day_width() {
        const { column_width, unit, step } = this.gantt.config;
        return (date_utils.convert_scales('1d', unit) / step) * column_width;
    }

    prepare_values() {
        super.prepare_values();
        // Centre the diamond on the day cell the task starts in.
        this.x = this.x + this.day_width() / 2 - SIDE / 2;
        this.width = SIDE;
        // this.height stays bar_height so compute_y and the label baseline
        // (row centre) are unaffected; the square is centred inside that.
        this.bar_y = this.y + (this.height - SIDE) / 2;
    }

    draw_bar() {
        this.$bar = createSVG('rect', {
            x: this.x,
            y: this.bar_y,
            width: SIDE,
            height: SIDE,
            rx: 3,
            ry: 3,
            class: 'bar',
            append_to: this.bar_group,
        });
        if (this.task.color) this.$bar.style.fill = this.task.color;
        // No animateSVG here: animating width would move the rotation origin.

        if (this.invalid) this.$bar.classList.add('bar-invalid');

        // Required even though it is only a header decoration: the hover
        // handlers in Bar.setup_click_event query .highlight-<id> unguarded.
        const day = this.day_width();
        this.$date_highlight = this.gantt.create_el({
            classes: `date-range-highlight hide highlight-${this.task.id}`,
            width: day,
            left: this.x + SIDE / 2 - day / 2,
        });
        this.gantt.$lower_header.prepend(this.$date_highlight);
    }

    // A milestone has no duration to resize.
    draw_resize_handles() {
        this.handles = [];
    }

    update_handle_position() {}

    update_label_position() {
        const label = this.group.querySelector('.bar-label');
        // 'big' also stops update_label_position_on_horizontal_scroll from
        // sliding the label into the diamond.
        label.classList.add('big');
        label.setAttribute('x', this.$bar.getEndX() + 10);
    }

    compute_duration() {
        super.compute_duration();
        // Pin to one day so nothing downstream works with a zero-length span.
        this.duration =
            date_utils.convert_scales('1d', this.gantt.config.unit) /
            this.gantt.config.step;
    }

    compute_start_end_date() {
        const { column_width, step, unit } = this.gantt.config;
        const centre = this.$bar.getX() + this.$bar.getWidth() / 2;
        const x_in_units = (centre - this.day_width() / 2) / column_width;
        // Rounded as in Bar.compute_start_end_date (parseInt would truncate)
        const date = date_utils.add(
            this.gantt.gantt_start,
            Math.round(x_in_units * step),
            unit,
        );
        return { new_start_date: date, new_end_date: date };
    }

    date_changed() {
        const { new_start_date } = this.compute_start_end_date();
        if (Number(this.task._start) === Number(new_start_date)) return;

        this.task._start = new_start_date;
        this.task._end = new_start_date;
        // Base Bar reports end - 1s; a milestone reports the same date twice.
        this.gantt.trigger_event('date_change', [
            this.task,
            new_start_date,
            new_start_date,
        ]);
    }
}
