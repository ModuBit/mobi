# Calendar

Use the bundled `<viz-calendar>` element for a day schedule when this composition fits. Its Shadow DOM owns layout, colors and typography, including overlap lanes and event durations. The host registers it automatically before your fragment runs whenever the fragment mentions `viz-calendar` — no import, initialization or custom CSS. Its flat surface carries its own border and radius; do not wrap it in another `.card` or add another inset. Event colors follow the host theme (`--viz-*` tokens, light and dark). Event labels stay 14px in both short and full-day views; longer ranges compact the spacing, not the type. Short blocks show only the title instead of stretching the whole schedule for secondary text. Hover, focus or tap an event to see its full title, time and detail in the shared tooltip. Use custom HTML for a different calendar view.

## Static HTML

For a fixed snapshot, pass events as a JSON attribute:

```html
<viz-calendar
  date="2026-10-16"
  start="11:00"
  end="14:00"
  now="11:50"
  events='[
    {"title":"Standup","start":"12:00","end":"12:30"},
    {"title":"Email block","start":"12:00","end":"12:30","tone":"green"},
    {"title":"Design sync","start":"13:00","end":"14:00","detail":"Weekly","video":true}
  ]'
></viz-calendar>
```

Escape HTML attribute content, including apostrophes as `&#39;` inside single-quoted JSON. Attribute changes redraw synchronously when no JavaScript property overrides the events.

## JavaScript data

Assign an array directly to `calendar.events`. Configure it before appending so the first render includes the events:

```html
<div id="calendar-host"></div>
<script>
  {
    const calendar = document.createElement("viz-calendar");
    calendar.setAttribute("date", "2026-10-16");
    calendar.setAttribute("start", "11:00");
    calendar.setAttribute("end", "14:00");
    calendar.events = [
      { title: "Standup", start: "12:00", end: "12:30" },
      { title: "Email block", start: "12:00", end: "12:30", tone: "green" },
      { title: "Design sync", start: "13:00", end: "14:00", video: true },
    ];
    document.getElementById("calendar-host").append(calendar);
  }
</script>
```

Keep the element reference for updates: `calendar.events = updatedEvents` redraws synchronously. Replace the array to update; mutating an array or an event in place does not trigger a render. Text is escaped by the renderer, so JavaScript values need no HTML-attribute escaping.

The property takes precedence over the `events` attribute until assigned `undefined`, which restores attribute input. Assign `[]` to clear the schedule. Property data is not reflected into HTML attributes; keep it separately when saving or restoring the fragment.

## Event selection

Add `interactive` when the fragment handles event selection. Each event becomes a native button, supporting click, Enter and Space. Listen on the calendar or an ancestor:

```js
const selection = document.createElement("output");
selection.setAttribute("aria-live", "polite");
calendar.after(selection);
calendar.setAttribute("interactive", "");
calendar.addEventListener("eventselect", ({ detail: { event } }) => {
  selection.textContent = `${event.title} · ${event.start}-${event.end}`;
});
```

`eventselect` bubbles across Shadow DOM. Its `detail.event` is the original supplied object, including any caller-owned ID; `detail.index` is its position in the input array, before sorting or clipping. Without `interactive`, event buttons expose their details in the tooltip without emitting a selection. Selection does not change calendar data or contact a service.

Pair `interactive` with `MobiApp.issueNewTurn` only when the user explicitly chooses to send a selected event back to the conversation.

## Switching days

The component renders one day and has no built-in tabs. Add shared tabs (SKILL.md §8) outside it only when there are two or more supplied days to switch between; omit tabs for a single day. On selection, assign the chosen day's `date` and `events` to the same element. Do not invent more days to fill a tab bar.

## Configuration

| Attribute      | Meaning                                                           |
| -------------- | ---------------------------------------------------------------- |
| `date`         | Required calendar date, `YYYY-MM-DD`.                             |
| `start`, `end` | Visible time window; defaults to `09:00`–`17:00`. `24:00` allowed as `end`. |
| `now`          | Optional current-time marker. Supply only when verified.          |
| `time-zone`    | Optional short zone label; does not convert timestamps.           |
| `lang`         | Date-formatting locale; defaults to the document language (`en`). |
| `empty-label`  | Empty-state text; defaults to "无日程" for `zh*` locales, else "No events". |
| `interactive`  | Boolean attribute; enables event buttons that emit `eventselect`. |

Times are local wall-clock `HH:MM`. Convert source timestamps to the requested date and zone before passing them in. Use the three hours around the next event for a brief check-in or the requested range for a full-day view.

Each event requires `title`, `start` and `end`. Optional fields are `tone` (`blue`, `green`, `red`, `orange`, `purple`, `yellow`; defaults to blue), `detail` (short secondary text) and `video` (a boolean that shows a video-call icon). Keep a small, consistent palette for source calendars or categories. Supply at most 200 events; events outside the visible window are clipped or omitted. Invalid data produces an inline error that clears when valid data is supplied — never silently invent dates or drop events.

## Rendering and updates

The component builds its styled shadow tree synchronously on connection and updates it synchronously on assignment or attribute change. It is a supplied snapshot: no connector, booking, background clock or network access. Refresh data in the host and pass the resulting array to `events`; update `now` separately when needed. Keep extra facts in the surrounding response.
