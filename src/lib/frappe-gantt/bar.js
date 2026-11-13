import date_utils from './date_utils';
import { $, createSVG, animateSVG } from './svg_utils';

// Local addition: avatars next to bars
const AVATAR_SIZE = 18;
let avatar_seq = 0;

export default class Bar {
    constructor(gantt, task) {
        this.set_defaults(gantt, task);
        this.prepare_wrappers();
        this.prepare_helpers();
        this.refresh();
    }

    refresh() {
        this.bar_group.innerHTML = '';
        this.handle_group.innerHTML = '';
        // Authoritative rewrite rather than classList.add: custom_class may hold
        // several tokens ('milestone critical'), which add() rejects, and a token
        // dropped since the last refresh has to disappear from the group.
        this.group.setAttribute(
            'class',
            'bar-wrapper' +
                (this.task.custom_class ? ' ' + this.task.custom_class : ''),
        );

        this.prepare_values();
        this.draw();
        this.bind();
    }

    set_defaults(gantt, task) {
        this.action_completed = false;
        this.gantt = gantt;
        this.task = task;
        this.name = this.name || '';
    }

    prepare_wrappers() {
        this.group = createSVG('g', {
            class:
                'bar-wrapper' +
                (this.task.custom_class ? ' ' + this.task.custom_class : ''),
            'data-id': this.task.id,
        });
        this.bar_group = createSVG('g', {
            class: 'bar-group',
            append_to: this.group,
        });
        this.handle_group = createSVG('g', {
            class: 'handle-group',
            append_to: this.group,
        });
    }

    prepare_values() {
        this.invalid = this.task.invalid;
        this.height = this.gantt.options.bar_height;
        this.image_size = this.height - 5;
        if (!this.task._start) this.task._start = new Date(this.task.start);
        if (!this.task._end) this.task._end = new Date(this.task.end);
        this.compute_x();
        this.compute_y();
        this.compute_duration();
        this.corner_radius = this.gantt.options.bar_corner_radius;
        this.width = this.gantt.config.column_width * this.duration;
    }

    prepare_helpers() {
        SVGElement.prototype.getX = function () {
            return +this.getAttribute('x');
        };
        SVGElement.prototype.getY = function () {
            return +this.getAttribute('y');
        };
        SVGElement.prototype.getWidth = function () {
            return +this.getAttribute('width');
        };
        SVGElement.prototype.getHeight = function () {
            return +this.getAttribute('height');
        };
        SVGElement.prototype.getEndX = function () {
            return this.getX() + this.getWidth();
        };
    }

    draw() {
        this.draw_bar();
        this.$span = null;
        if (this.task._span) this.draw_span();
        this.draw_label();
        this.draw_resize_handles();

        if (this.task.thumbnail) {
            this.draw_thumbnail();
        }
        // Local addition: the assignees' avatars next to the bar
        this.$avatars = null;
        if (this.task._avatars && this.task._avatars.length) this.draw_avatars();
    }

    // Local addition: up to three avatars after the bar (after its label when
    // the label sits outside), from task._avatars = [{ url?, initials,
    // color }]. A picture that fails to load is removed, leaving the initials.
    draw_avatars() {
        const size = AVATAR_SIZE;
        const list = this.task._avatars;
        this.$avatars = createSVG('g', {
            class: 'bar-avatars',
            append_to: this.bar_group,
        });
        list.slice(0, 3).forEach((a, i) => {
            const g = createSVG('g', {
                class: 'bar-avatar',
                transform: `translate(${i * (size - 6)}, 0)`,
                append_to: this.$avatars,
            });
            const bg = createSVG('circle', { cx: 0, cy: 0, r: size / 2, class: 'bar-avatar__bg', append_to: g });
            bg.style.fill = a.color || '#7c85f5';
            const text = createSVG('text', { x: 0, y: 0, class: 'bar-avatar__text', append_to: g });
            text.textContent = a.initials || '?';
            if (a.url) {
                const id = `bar-av-${++avatar_seq}`;
                const clip = createSVG('clipPath', { id, append_to: g });
                createSVG('circle', { cx: 0, cy: 0, r: size / 2, append_to: clip });
                const img = createSVG('image', {
                    x: -size / 2,
                    y: -size / 2,
                    width: size,
                    height: size,
                    preserveAspectRatio: 'xMidYMid slice',
                    'clip-path': `url(#${id})`,
                    append_to: g,
                });
                img.addEventListener('error', () => img.remove());
                img.setAttribute('href', a.url);
            }
            const title = createSVG('title', { append_to: g });
            title.textContent = a.name || '';
        });
        if (list.length > 3) {
            const more = createSVG('text', {
                x: 3 * (size - 6) - 2,
                y: 0,
                class: 'bar-avatar__more',
                append_to: this.$avatars,
            });
            more.textContent = `+${list.length - 3}`;
        }
        this.update_avatars_position();
    }

    // After the bar, or after the label when it is drawn outside the bar
    update_avatars_position() {
        if (!this.$avatars) return;
        const label = this.group.querySelector('.bar-label');
        let x = this.$bar.getEndX() + 6;
        if (label && label.classList.contains('big')) {
            const box = label.getBBox();
            x = box.x + box.width + 8;
        }
        const y = this.$bar.getY() + this.$bar.getHeight() / 2;
        this.$avatars.setAttribute(
            'transform',
            `translate(${x + AVATAR_SIZE / 2}, ${y})`,
        );
    }

    draw_bar() {
        this.$bar = createSVG('rect', {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            rx: this.corner_radius,
            ry: this.corner_radius,
            class: 'bar',
            append_to: this.bar_group,
        });
        if (this.task.color) this.$bar.style.fill = this.task.color;
        animateSVG(this.$bar, 'width', 0, this.width);

        if (this.invalid) {
            this.$bar.classList.add('bar-invalid');
        }

        const x =
            (date_utils.diff(
                this.task._start,
                this.gantt.gantt_start,
                this.gantt.config.unit,
            ) /
                this.gantt.config.step) *
            this.gantt.config.column_width;

        let $date_highlight = this.gantt.create_el({
            classes: `date-range-highlight hide highlight-${this.task.id}`,
            width: this.width,
            left: x,
        });
        this.$date_highlight = $date_highlight;
        this.gantt.$lower_header.prepend(this.$date_highlight);
    }

    // Local addition: thin bracket under a parent's bar covering its subtasks
    // (task._span = { start, end }, inclusive dates). Shifted with the bar in
    // update_bar_position, since the subtasks move along in a drag.
    draw_span() {
        const { column_width, unit, step } = this.gantt.config;
        const toX = (d) =>
            (date_utils.diff(d, this.gantt.gantt_start, unit) / step) *
            column_width;
        const start = date_utils.parse(this.task._span.start);
        const end = date_utils.add(
            date_utils.parse(this.task._span.end),
            24,
            'hour',
        );
        const x = toX(start);
        this.$span = createSVG('rect', {
            x,
            y: this.y + this.height + 3,
            width: Math.max(2, toX(end) - x),
            height: 4,
            rx: 2,
            ry: 2,
            class: 'bar-span',
            append_to: this.bar_group,
        });
        this.span_offset = x - this.x;
    }

    // Local addition: replaces the span without a refresh (null removes it),
    // so a parent's bracket can follow a subtask while it is dragged.
    set_span(span) {
        const old = this.$span;
        this.task._span = span;
        this.$span = null;
        if (span) this.draw_span();
        if (old && this.$span) old.replaceWith(this.$span);
        else old?.remove();
    }

    draw_label() {
        let x_coord = this.x + this.$bar.getWidth() / 2;

        if (this.task.thumbnail) {
            x_coord = this.x + this.image_size + 5;
        }

        const $label = createSVG('text', {
            x: x_coord,
            y: this.y + this.height / 2,
            innerHTML: this.task.name,
            class: 'bar-label',
            append_to: this.bar_group,
        });
        // Local addition: text color for a label drawn on a task.color fill,
        // picked by the host for contrast. gantt.css reads it while the label
        // sits inside the bar; a .big label (outside) keeps the theme color.
        if (this.task.text_color)
            $label.style.setProperty('--g-bar-text', this.task.text_color);
        // labels get BBox in the next tick
        requestAnimationFrame(() => this.update_label_position());
    }

    draw_thumbnail() {
        let x_offset = 10,
            y_offset = 2;
        let defs, clipPath;

        defs = createSVG('defs', {
            append_to: this.bar_group,
        });

        createSVG('rect', {
            id: 'rect_' + this.task.id,
            x: this.x + x_offset,
            y: this.y + y_offset,
            width: this.image_size,
            height: this.image_size,
            rx: '15',
            class: 'img_mask',
            append_to: defs,
        });

        clipPath = createSVG('clipPath', {
            id: 'clip_' + this.task.id,
            append_to: defs,
        });

        createSVG('use', {
            href: '#rect_' + this.task.id,
            append_to: clipPath,
        });

        createSVG('image', {
            x: this.x + x_offset,
            y: this.y + y_offset,
            width: this.image_size,
            height: this.image_size,
            class: 'bar-img',
            href: this.task.thumbnail,
            clipPath: 'clip_' + this.task.id,
            append_to: this.bar_group,
        });
    }

    draw_resize_handles() {
        if (this.invalid || this.gantt.options.readonly) return;

        const bar = this.$bar;
        const handle_width = 3;
        this.handles = [];
        if (
            !this.gantt.options.readonly_dates &&
            !this.gantt.options.fixed_duration
        ) {
            this.handles.push(
                createSVG('rect', {
                    x: bar.getEndX() - handle_width / 2,
                    y: bar.getY() + this.height / 4,
                    width: handle_width,
                    height: this.height / 2,
                    rx: 2,
                    ry: 2,
                    class: 'handle right',
                    append_to: this.handle_group,
                }),
            );

            this.handles.push(
                createSVG('rect', {
                    x: bar.getX() - handle_width / 2,
                    y: bar.getY() + this.height / 4,
                    width: handle_width,
                    height: this.height / 2,
                    rx: 2,
                    ry: 2,
                    class: 'handle left',
                    append_to: this.handle_group,
                }),
            );
        }
        for (let handle of this.handles) {
            $.on(handle, 'mouseenter', () => handle.classList.add('active'));
            $.on(handle, 'mouseleave', () => handle.classList.remove('active'));
        }
    }

    bind() {
        if (this.invalid) return;
        this.setup_click_event();
    }

    setup_click_event() {
        let task_id = this.task.id;
        $.on(this.group, 'mouseover', (e) => {
            this.gantt.trigger_event('hover', [
                this.task,
                e.screenX,
                e.screenY,
                e,
            ]);
        });

        if (this.gantt.options.popup_on === 'click') {
            $.on(this.group, 'mouseup', (e) => {
                if (this.gantt.bar_being_dragged) return;
                this.gantt.show_popup({
                    x: e.offsetX || e.layerX,
                    y: e.offsetY || e.layerY,
                    task: this.task,
                    target: this.$bar,
                });
            });
        }
        let timeout;
        $.on(this.group, 'mouseenter', (e) => {
            timeout = setTimeout(() => {
                if (this.gantt.options.popup_on === 'hover')
                    this.gantt.show_popup({
                        x: e.offsetX || e.layerX,
                        y: e.offsetY || e.layerY,
                        task: this.task,
                        target: this.$bar,
                    });
                // Local fix: the bar may be gone (deleted from the keyboard
                // while hovered) by the time the timer fires
                this.gantt.$container
                    .querySelector(`.highlight-${task_id}`)
                    ?.classList.remove('hide');
            }, 200);
        });
        $.on(this.group, 'mouseleave', () => {
            clearTimeout(timeout);
            if (this.gantt.options.popup_on === 'hover')
                this.gantt.popup?.hide?.();
            this.gantt.$container
                .querySelector(`.highlight-${task_id}`)
                ?.classList.add('hide');
        });

        // Local changes: a drop is not a click (action_completed is set by
        // the drag end for a bar that moved), and the event goes along so
        // the host can read the modifier keys
        $.on(this.group, 'click', (e) => {
            if (this.action_completed) return;
            this.gantt.trigger_event('click', [this.task, e]);
        });

        $.on(this.group, 'dblclick', (e) => {
            if (this.action_completed) {
                // just finished a move action, wait for a few seconds
                return;
            }
            this.group.classList.remove('active');
            if (this.gantt.popup)
                this.gantt.popup.parent.classList.remove('hide');

            this.gantt.trigger_event('double_click', [this.task, e]);
        });
        let tapedTwice = false;
        $.on(this.group, 'touchstart', (e) => {
            if (!tapedTwice) {
                tapedTwice = true;
                setTimeout(function () {
                    tapedTwice = false;
                }, 300);
                return false;
            }
            e.preventDefault();

            if (this.action_completed) {
                return;
            }
            this.group.classList.remove('active');
            if (this.gantt.popup)
                this.gantt.popup.parent.classList.remove('hide');

            this.gantt.trigger_event('double_click', [this.task]);
        });
    }

    update_bar_position({ x = null, width = null }) {
        const bar = this.$bar;

        if (x) {
            const xs = this.task.dependencies
                .map((dep) => this.gantt.get_bar(dep))
                .filter(Boolean)
                .map((dep_bar) => dep_bar.$bar.getX());
            const valid_x = xs.reduce((prev, curr) => {
                return prev && x >= curr;
            }, true);
            if (!valid_x) return;
            this.update_attr(bar, 'x', x);
            this.x = x;
            if (this.$span) this.update_attr(this.$span, 'x', x + this.span_offset);
            this.$date_highlight.style.left = x + 'px';
        }
        if (width > 0) {
            this.update_attr(bar, 'width', width);
            this.$date_highlight.style.width = width + 'px';
        }

        this.update_label_position();
        this.update_handle_position();
        this.compute_duration();
        this.date_changed();
        this.update_arrow_position();
    }

    update_label_position_on_horizontal_scroll({ x, sx }) {
        const container = this.gantt.$container;
        const label = this.group.querySelector('.bar-label');
        const img = this.group.querySelector('.bar-img') || '';
        const img_mask = this.bar_group.querySelector('.img_mask') || '';

        let barWidthLimit = this.$bar.getX() + this.$bar.getWidth();
        let newLabelX = label.getX() + x;
        let newImgX = (img && img.getX() + x) || 0;
        let imgWidth = (img && img.getBBox().width + 7) || 7;
        let labelEndX = newLabelX + label.getBBox().width + 7;
        let viewportCentral = sx + container.clientWidth / 2;

        if (label.classList.contains('big')) return;

        if (labelEndX < barWidthLimit && x > 0 && labelEndX < viewportCentral) {
            label.setAttribute('x', newLabelX);
            if (img) {
                img.setAttribute('x', newImgX);
                img_mask.setAttribute('x', newImgX);
            }
        } else if (
            newLabelX - imgWidth > this.$bar.getX() &&
            x < 0 &&
            labelEndX > viewportCentral
        ) {
            label.setAttribute('x', newLabelX);
            if (img) {
                img.setAttribute('x', newImgX);
                img_mask.setAttribute('x', newImgX);
            }
        }
    }

    date_changed() {
        let changed = false;
        const { new_start_date, new_end_date } = this.compute_start_end_date();
        if (Number(this.task._start) !== Number(new_start_date)) {
            changed = true;
            this.task._start = new_start_date;
        }

        if (Number(this.task._end) !== Number(new_end_date)) {
            changed = true;
            this.task._end = new_end_date;
        }

        if (!changed) return;

        this.gantt.trigger_event('date_change', [
            this.task,
            new_start_date,
            date_utils.add(new_end_date, -1, 'second'),
        ]);
    }

    set_action_completed() {
        this.action_completed = true;
        setTimeout(() => (this.action_completed = false), 1000);
    }

    compute_start_end_date() {
        const bar = this.$bar;
        const { column_width, step, unit } = this.gantt.config;
        // Local fix: x and width are snapped to whole units, but the float
        // math can give 60.99999 for 61 and date_utils.add parseInt's it,
        // landing a day early. Round first (x_to_date does).
        const new_start_date = this.gantt.x_to_date(bar.getX());
        if (unit === 'month') {
            // Local fix: Month view rounded a drop to whole months. A drag
            // (width unchanged since mousedown) keeps the length in days, a
            // resize reads the day under the new end.
            const dragged =
                bar.owidth !== undefined &&
                Math.abs(bar.getWidth() - bar.owidth) < 0.5;
            const new_end_date = dragged
                ? date_utils.add(
                      new_start_date,
                      Math.round(
                          date_utils.diff(this.task._end, this.task._start, 'day'),
                      ),
                      'day',
                  )
                : this.gantt.x_to_date(bar.getX() + bar.getWidth());
            return { new_start_date, new_end_date };
        }

        const width_in_units = bar.getWidth() / column_width;
        const new_end_date = date_utils.add(
            new_start_date,
            Math.round(width_in_units * step),
            unit,
        );

        return { new_start_date, new_end_date };
    }

    compute_x() {
        const { column_width } = this.gantt.config;
        const task_start = this.task._start;
        const gantt_start = this.gantt.gantt_start;

        const diff =
            date_utils.diff(task_start, gantt_start, this.gantt.config.unit) /
            this.gantt.config.step;

        let x = diff * column_width;

        this.x = x;
    }

    compute_y() {
        this.y =
            this.gantt.config.header_height +
            this.gantt.options.padding / 2 +
            this.task._index * (this.height + this.gantt.options.padding);
    }

    compute_duration() {
        let actual_duration_in_days = 0,
            duration_in_days = 0;
        for (
            let d = new Date(this.task._start);
            d < this.task._end;
            d.setDate(d.getDate() + 1)
        ) {
            duration_in_days++;
            if (
                !this.gantt.config.ignored_dates.find(
                    (k) => k.getTime() === d.getTime(),
                ) &&
                (!this.gantt.config.ignored_function ||
                    !this.gantt.config.ignored_function(d))
            ) {
                actual_duration_in_days++;
            }
        }
        this.task.actual_duration = actual_duration_in_days;
        this.task.ignored_duration = duration_in_days - actual_duration_in_days;

        this.duration =
            date_utils.convert_scales(
                duration_in_days + 'd',
                this.gantt.config.unit,
            ) / this.gantt.config.step;

        this.actual_duration_raw =
            date_utils.convert_scales(
                actual_duration_in_days + 'd',
                this.gantt.config.unit,
            ) / this.gantt.config.step;

        this.ignored_duration_raw = this.duration - this.actual_duration_raw;
    }

    update_attr(element, attr, value) {
        value = +value;
        if (!isNaN(value)) {
            element.setAttribute(attr, value);
        }
        return element;
    }

    update_label_position() {
        const img_mask = this.bar_group.querySelector('.img_mask') || '';
        const bar = this.$bar,
            label = this.group.querySelector('.bar-label'),
            img = this.group.querySelector('.bar-img');

        let padding = 5;
        let x_offset_label_img = this.image_size + 10;
        const labelWidth = label.getBBox().width;
        const barWidth = bar.getWidth();
        if (labelWidth > barWidth) {
            label.classList.add('big');
            if (img) {
                img.setAttribute('x', bar.getEndX() + padding);
                img_mask.setAttribute('x', bar.getEndX() + padding);
                label.setAttribute('x', bar.getEndX() + x_offset_label_img);
            } else {
                label.setAttribute('x', bar.getEndX() + padding);
            }
        } else {
            label.classList.remove('big');
            if (img) {
                img.setAttribute('x', bar.getX() + padding);
                img_mask.setAttribute('x', bar.getX() + padding);
                label.setAttribute(
                    'x',
                    bar.getX() + barWidth / 2 + x_offset_label_img,
                );
            } else {
                label.setAttribute(
                    'x',
                    bar.getX() + barWidth / 2 - labelWidth / 2,
                );
            }
        }
        this.update_avatars_position();
    }

    update_handle_position() {
        if (this.invalid || this.gantt.options.readonly) return;
        const bar = this.$bar;
        this.handle_group
            .querySelector('.handle.left')
            .setAttribute('x', bar.getX());
        this.handle_group
            .querySelector('.handle.right')
            .setAttribute('x', bar.getEndX());
    }

    update_arrow_position() {
        this.arrows = this.arrows || [];
        for (let arrow of this.arrows) {
            arrow.update();
        }
    }
}
