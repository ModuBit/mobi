/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * `<viz-calendar>` 日视图组件（visualize-runtime 票 04）。
 *
 * 仅当 fragment 提及 viz-calendar 时按需注入（assembleVizDocument 挂钩），注册在
 * fragment 解析之前——connectedCallback 同步构建带样式的 Shadow DOM，无网络请求、
 * 无 hydration 帧。语义对标 codex visualize 的 calendar（属性/事件/lane 分配/布局
 * 约定），实现全部自研：token 走 `--viz-*`（随宿主双档）、字体继承宿主（不指定
 * 具体字体族）、错误文案中文（面向中文用户）。
 *
 * 契约要点（详见 widgets/calendar.md）：
 * - 属性：date（必填 YYYY-MM-DD）/ start / end（缺省 09:00–17:00，24:00 可作 end）/
 *   now / time-zone / lang / empty-label / interactive
 * - JS：`calendar.events = [...]` 整体替换同步重绘；升级前赋值重放；属性输入在 JS
 *   赋值后让位、赋 undefined 恢复
 * - 事件字段：title/start/end 必填 + tone/detail/video；≤200 条
 * - interactive → 事件为原生 button，冒泡 eventselect（detail.event 原始对象 +
 *   detail.index 输入序）
 * - 非法数据 → shadow 内 role="alert" 内联错误（可恢复），不静默丢弃
 *
 * 纯逻辑（时间解析 / lane 分配）以真实 TS 函数导出，脚本经 toString() 内联同一份
 * 实现——单源，单测直接测函数本体（vizCalendar.test.ts）。
 */

/** HH:MM → 当日分钟数；`24:00` 允许（作窗口 end）。非法值抛错（错误文案面向用户） */
export function vizTimeToMinutes(value: unknown): number {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value)) {
        throw new Error('时间须为 00:00–24:00 之间的 HH:MM。')
    }
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
}

/** lane 分配的输入/输出形状（运行时只有 from/to 参与，lane/lanes 原地写回） */
export interface VizLaneEvent {
    from: number
    to: number
    lane: number
    lanes: number
}

/**
 * 重叠 lane 分配（原地写回 lane/lanes）：
 * - 相邻事件共享 lane（前一事件 end == 后一事件 start 时同列）
 * - 一条重叠链（connected overlap group）内共享同一列数 lanes——链里最挤时刻的
 *   并发数决定组内所有事件的宽度
 * 输入须已按 from 升序（并列时 to 降序更稳，但不作前置条件）。
 */
export function assignVizLanes(events: VizLaneEvent[]): void {
    let group: VizLaneEvent[] = []
    let laneEnds: number[] = []
    let groupEnd = -1
    const finishGroup = () => {
        for (const event of group) event.lanes = laneEnds.length
    }
    for (const event of events) {
        if (event.from >= groupEnd) {
            finishGroup()
            group = []
            laneEnds = []
        }
        // 找最早空闲 lane（end <= from 即已让位，含相邻让位）
        let lane = laneEnds.findIndex((until) => until <= event.from)
        if (lane < 0) lane = laneEnds.length
        event.lane = lane
        laneEnds[lane] = event.to
        group.push(event)
        groupEnd = Math.max(event.to, groupEnd)
    }
    finishGroup()
}

/** 组件内部渲染用的调色板（tone → --viz-* 语义色，票 02 token） */
const TONE_VARS: Record<string, string> = {
    blue: 'var(--viz-blue)',
    green: 'var(--viz-green)',
    red: 'var(--viz-red)',
    orange: 'var(--viz-orange)',
    purple: 'var(--viz-purple)',
    yellow: 'var(--viz-yellow)',
}

/** 组件脚本（custom element 注册；随组装内联，fragment 解析前执行） */
export const VIZ_CALENDAR_SCRIPT = `
(() => {
  if (customElements.get('viz-calendar')) return;
  ${vizTimeToMinutes.toString()}
  ${assignVizLanes.toString()}
  const TONE_VARS = ${JSON.stringify(TONE_VARS)};
  const style = \`
    :host{display:block;min-width:0;padding:12px;font:400 14px/1.5 var(--viz-font-body);color:var(--viz-fg);container-type:inline-size;border:1px solid var(--viz-border);border-radius:var(--viz-radius)}
    *{box-sizing:border-box}
    .layout{display:grid;grid-template-columns:88px minmax(0,1fr);gap:24px}
    .date{display:flex;flex-direction:column;gap:8px;padding-top:8px;border-right:1px solid var(--viz-border)}
    .weekday,.context{color:color-mix(in srgb,var(--viz-fg) 65%,var(--viz-bg))}
    .day{font-size:48px;line-height:1.1;letter-spacing:-.03em}
    .context{font-size:12px;line-height:16px;overflow-wrap:anywhere}
    .axis{--hour:max(48px,var(--minimum-hour));position:relative;height:calc(var(--hours)*var(--hour) + 16px);margin-top:8px;min-width:0}
    .axis.compact{--hour:max(32px,var(--minimum-hour))}
    .hour{position:absolute;top:calc(var(--at)*var(--hour));inset-inline:0;color:var(--viz-fg-muted)}
    .hour span{display:block;width:36px;text-align:right;transform:translateY(-50%);font-variant-numeric:tabular-nums}
    .hour::after{content:"";position:absolute;top:0;left:48px;right:0;border-top:1px solid var(--viz-border)}
    .events{position:absolute;inset:0 0 16px 48px;margin:0;padding:0;list-style:none;overflow:hidden}
    .event{position:absolute;top:calc(var(--at)*var(--hour) + 2px);height:calc(var(--duration)*var(--hour) - 4px);left:calc(var(--lane)*100%/var(--lanes) + var(--lane)*8px/var(--lanes));width:calc((100% - (var(--lanes) - 1)*8px)/var(--lanes));border-radius:8px;background:linear-gradient(110deg,color-mix(in srgb,var(--tone) 24%,var(--viz-bg)),color-mix(in srgb,var(--tone) 32%,var(--viz-bg)));overflow:hidden;container-type:size}
    .event.past{background:color-mix(in srgb,var(--tone) 12%,var(--viz-bg));color:color-mix(in srgb,var(--viz-fg) 70%,var(--viz-bg))}
    .event-body{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:100%;padding:4px 12px;font:inherit;color:inherit;text-align:left}
    button.event-body{appearance:none;border:0;border-radius:inherit;background:transparent;cursor:pointer}
    button.event-body:hover{background:color-mix(in srgb,var(--viz-fg) 2%,transparent)}
    button.event-body:focus-visible{outline:2px solid var(--viz-primary);outline-offset:-2px}
    .event-content{min-width:0}
    .title{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .detail{display:block;font-size:12px;line-height:16px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    @container(max-height:48px){.detail{display:none}.event-body{padding-block:0}}
    .video{width:16px;height:16px;flex:none}
    .now{position:absolute;top:calc(var(--at)*var(--hour));left:48px;right:0;border-top:2px solid var(--viz-danger);pointer-events:none}
    .now::before{content:"";position:absolute;left:-4px;top:-5px;width:8px;height:8px;border-radius:50%;background:var(--viz-danger)}
    .now span{position:absolute;right:calc(100% + 12px);transform:translateY(-50%);color:var(--viz-danger);font:400 12px/16px var(--viz-font-body);font-variant-numeric:tabular-nums}
    .empty{position:absolute;top:24px;left:64px;color:var(--viz-fg-muted)}
    @media(pointer:coarse){:host .axis{--hour:max(48px,var(--minimum-hour),var(--minimum-target-hour))}}
    @container(max-width:520px){.layout{grid-template-columns:minmax(0,1fr)}.date{flex-direction:row;align-items:baseline;border:0;padding:0}.event-body{padding-inline:8px}}
  \`;
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  class MobiVizCalendar extends HTMLElement {
    #initialized = false;
    #events;
    static observedAttributes = ['date', 'start', 'end', 'now', 'events', 'lang', 'time-zone', 'empty-label', 'interactive'];

    constructor() {
      super();
      // 组件注册前的赋值重放（升级语义：早到的数据不丢）
      if (Object.hasOwn(this, 'events')) {
        const events = this.events;
        delete this.events;
        this.events = events;
      }
    }

    get events() {
      return this.#events === undefined ? JSON.parse(this.getAttribute('events') ?? '[]') : this.#events;
    }

    set events(events) {
      this.#events = events;
      if (this.#initialized) this.render();
    }

    connectedCallback() {
      // 无既有 shadow（非 declarative shadow DOM 升级）时现场构建
      if (!this.shadowRoot) {
        this.attachShadow({ mode: 'open', serializable: true });
        this.render();
      } else if (!this.#initialized && this.#events !== undefined) {
        this.render();
      }
      if (!this.#initialized) {
        this.shadowRoot.addEventListener('click', (event) => {
          const button = event.target.closest?.('button[data-event-index]');
          if (!button) return;
          const index = Number(button.dataset.eventIndex);
          this.dispatchEvent(new CustomEvent('eventselect', {
            bubbles: true,
            composed: true,
            detail: { event: this.events[index], index },
          }));
        });
      }
      this.#initialized = true;
    }

    attributeChangedCallback(name, before, after) {
      if (before !== after && this.#initialized && this.shadowRoot) this.render();
    }

    render() {
      const shadow = this.shadowRoot;
      try {
        const date = this.getAttribute('date') ?? '';
        const calendarDate = new Date(date + 'T12:00:00Z');
        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || !Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date) {
          throw new Error('请提供合法的日历日期（YYYY-MM-DD）。');
        }
        const start = vizTimeToMinutes(this.getAttribute('start') ?? '09:00');
        const end = vizTimeToMinutes(this.getAttribute('end') ?? '17:00');
        if (end <= start) throw new Error('可见窗口的结束时间必须晚于开始时间。');
        const now = this.hasAttribute('now') ? vizTimeToMinutes(this.getAttribute('now')) : null;
        const input = this.events;
        if (!Array.isArray(input) || input.length > 200) throw new Error('事件须为数组，且不超过 200 条。');
        const events = input
          .map((event, index) => {
            if (event == null || typeof event !== 'object' || typeof event.title !== 'string') {
              throw new Error('每个事件都需要 title、start 与 end。');
            }
            const from = vizTimeToMinutes(event.start);
            const to = vizTimeToMinutes(event.end);
            if (to <= from) throw new Error('事件的结束时间必须晚于开始时间。');
            if (event.detail != null && typeof event.detail !== 'string') throw new Error('事件的 detail 必须是文本。');
            return { ...event, index, from, to, lane: 0, lanes: 1 };
          })
          .filter((event) => event.from < end && event.to > start)
          .sort((a, b) => a.from - b.from || b.to - a.to);
        assignVizLanes(events);

        const locale = this.lang || document.documentElement.lang || 'en';
        const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(calendarDate);
        const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(calendarDate);
        const timeZone = this.getAttribute('time-zone');
        const ticks = [start];
        for (let tick = (Math.floor(start / 60) + 1) * 60; tick < end; tick += 60) ticks.push(tick);
        ticks.push(end);
        const labelTime = (time) => String(Math.floor(time / 60)).padStart(2, '0') + ':' + String(time % 60).padStart(2, '0');
        const compact = end - start > 240;
        // 高度下限按完整事件时长算：窗口裁掉超界事件不放大轴高（1 分钟残条不撑整轴）
        const minimumHour = Math.max(0, ...events.map((event) => (28 * 60) / (event.to - event.from)));
        const minimumTargetHour = Math.max(0, ...events.map((event) => (48 * 60) / (event.to - event.from)));
        const hourMarkup = ticks
          .map((tick) => '<div class="hour" style="--at:' + (tick - start) / 60 + '">' + (now != null && now >= start && now <= end && Math.abs(tick - now) < 15 ? '' : '<span>' + (tick % 60 ? labelTime(tick) : tick / 60) + '</span>') + '</div>')
          .join('');
        const interactive = this.hasAttribute('interactive');
        const eventMarkup = events
          .map((event) => {
            const label = escape(event.title + ', ' + event.start + '-' + event.end + (event.detail ? ', ' + event.detail : ''));
            const body = 'button type="button"' + (interactive ? ' data-event-index="' + event.index + '"' : '') + ' aria-label="' + label + '" data-tooltip="' + label + '"';
            return '<li class="event' + (now != null && event.to <= now ? ' past' : '') + '" style="--at:' + (event.from - start) / 60 + ';--duration:' + (event.to - event.from) / 60 + ';--lane:' + event.lane + ';--lanes:' + event.lanes + ';--tone:' + (TONE_VARS[event.tone] ?? TONE_VARS.blue) + '"><' + body + ' class="event-body"><span class="event-content"><span class="title">' + escape(event.title) + '</span>' + (event.detail ? '<span class="detail">' + escape(event.detail) + '</span>' : '') + '</span>' + (event.video ? '<svg class="video" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>' : '') + '</button></li>';
          })
          .join('');
        const nowMarkup = now != null && now >= start && now <= end
          ? '<div class="now" style="--at:' + (now - start) / 60 + '" role="img" aria-label="' + escape(labelTime(now)) + '"><span>' + labelTime(now) + '</span></div>'
          : '';
        const defaultEmpty = locale.toLowerCase().startsWith('zh') ? '无日程' : 'No events';
        shadow.innerHTML = '<style>' + style + '</style><section class="calendar" aria-label="' + escape(fullDate) + '"><div class="layout"><div class="date"><span class="weekday">' + escape(weekday) + '</span><span class="day">' + Number(date.slice(-2)) + '</span>' + (timeZone ? '<span class="context">' + escape(timeZone) + '</span>' : '') + '</div><div class="axis' + (compact ? ' compact' : '') + '" style="--hours:' + (end - start) / 60 + ';--minimum-hour:' + minimumHour + 'px;--minimum-target-hour:' + minimumTargetHour + 'px">' + hourMarkup + '<ol class="events">' + eventMarkup + '</ol>' + nowMarkup + (events.length ? '' : '<span class="empty">' + escape(this.getAttribute('empty-label') ?? defaultEmpty) + '</span>') + '</div></div></section>';
      } catch (error) {
        // 模型产出的非法输入保持可见且可恢复（改属性即重试）；绝不静默造日期/丢事件
        shadow.innerHTML = '<style>' + style + '</style><div class="calendar" role="alert">' + escape(error instanceof Error ? error.message : '日历数据不合法。') + '</div>';
      }
    }
  }
  customElements.define('viz-calendar', MobiVizCalendar);
})();
`
