<!--
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
 -->

<!-- ⚠️ 生成文件——勿手改。重生成：bun run packages/session/scripts/generate-openui-prompt.ts -->

# Full Signatures (95 components + 59 functions)

For a few names prefer the `openui_components` tool; this file is for browsing whole families.

## Component Signatures

Arguments marked with ? are optional. Sub-components can be inline or referenced; prefer references for better streaming.
Props typed `ActionExpression` accept one @step, or Action([@steps...]) for several. See the Action section for available steps (@ToAssistant, @OpenUrl).
Props marked `$binding<type>` accept a `$variable` reference for two-way binding.

### Layout
Stack(children: any[], direction?: "row" | "column", gap?: "none" | "xs" | "s" | "m" | "l" | "xl" | "2xl", align?: "start" | "center" | "end" | "stretch" | "baseline", justify?: "start" | "center" | "end" | "between" | "around" | "evenly", wrap?: boolean) — Flex container. direction: "row"|"column" (default "column"). gap: "none"|"xs"|"s"|"m"|"l"|"xl"|"2xl" (default "m"). align: "start"|"center"|"end"|"stretch"|"baseline". justify: "start"|"center"|"end"|"between"|"around"|"evenly".
Tabs(items: TabItem[]) — Tabbed container
TabItem(value: string, trigger: string, content: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Form | Buttons | IconButton | Steps | InlineHeader | EntityList | EditableTable | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[]) — value is unique id, trigger is tab label, content is array of components
Accordion(items: AccordionItem[]) — Collapsible sections
AccordionItem(value: string, trigger: string, content: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Form | Buttons | IconButton | Steps | InlineHeader | EntityList | EditableTable | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[]) — value is unique id, trigger is section title
Steps(items: StepsItem[]) — Step-by-step guide
StepsItem(title: string, details: string) — title and details text for one step
Carousel(children: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Form | Buttons | IconButton | Steps | InlineHeader | EntityList | EditableTable | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[][], variant?: "card" | "sunk") — Horizontal scrollable carousel
Separator(orientation?: "horizontal" | "vertical", decorative?: boolean) — Visual divider between content sections
Modal(title: string, open?: $binding<boolean>, children: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Form | Buttons | IconButton | Steps | InlineHeader | EntityList | EditableTable | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[], size?: "sm" | "md" | "lg") — Modal dialog. open is a reactive $boolean binding — set to true to open, X/Escape/backdrop auto-closes. Put Form with buttons inside children.
- For grid-like layouts, use Stack with direction "row" and wrap set to true.
- Prefer justify "start" (or omit justify) with wrap=true for stable columns instead of uneven gutters.
- Use nested Stacks when you need explicit rows/sections.
- Show/hide sections: $editId != "" ? Card([editForm]) : null
- Modal: Modal("Title", $showModal, [content]) — $showModal is boolean, X/Escape auto-closes. Put Form with its own buttons inside children.
- Use Tabs for alternative views (chart types, data sections) — no $variable needed
- Shared filter across Tabs: same $days binding in Query args works across all TabItems

### Content
Card(children: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Form | Buttons | IconButton | Steps | InlineHeader | EntityList | EditableTable | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock | Tabs | Carousel | Stack)[], variant?: "card" | "sunk" | "clear", direction?: "row" | "column", gap?: "none" | "xs" | "s" | "m" | "l" | "xl" | "2xl", align?: "start" | "center" | "end" | "stretch" | "baseline", justify?: "start" | "center" | "end" | "between" | "around" | "evenly", wrap?: boolean) — Styled container. variant: "card" (default, elevated) | "sunk" (recessed) | "clear" (transparent). Always full width. Accepts all Stack flex params (default: direction "column"). Cards flex to share space in row/wrap layouts.
CardHeader(title?: string, subtitle?: string) — Header with optional title and subtitle
TextContent(text: string, size?: "small" | "default" | "large" | "small-heavy" | "large-heavy") — Text block. Supports markdown. Optional size: "small" | "default" | "large" | "small-heavy" | "large-heavy".
MarkDownRenderer(textMarkdown: string, variant?: "clear" | "card" | "sunk") — Renders markdown text with optional container variant
Callout(variant: "info" | "warning" | "error" | "success" | "neutral", title: string, description: string, visible?: $binding<boolean>) — Callout banner. Optional visible is a reactive $boolean — auto-dismisses after 3s by setting $visible to false.
TextCallout(variant?: "neutral" | "info" | "warning" | "success" | "danger", title?: string, description?: string) — Text callout with variant, title, and description
Image(alt: string, src?: string) — Image with alt text and optional URL
ImageBlock(src: string, alt?: string) — Image block with loading state
ImageGallery(images: {src: string, alt?: string, details?: string}[]) — Gallery grid of images with modal preview
CodeBlock(language: string, codeString: string) — Syntax-highlighted code block
InlineHeader(heading: string, description?: string) — Compact section heading with an optional one-line description, for use inside cards.
- InlineHeader is a compact heading + description pair for labelling a block (lighter than CardHeader).
- Use Cards to group related KPIs or sections. Stack with direction "row" for side-by-side layouts.
- Success toast: Callout("success", "Saved", "Done.", $showSuccess) — use @Set($showSuccess, true) in save action, auto-dismisses after 3s. For errors: result.status == "error" ? Callout("error", "Failed", result.error) : null
- KPI card: Card([TextContent("Label", "small"), TextContent("" + @Count(@Filter(data.rows, "field", "==", "value")), "large-heavy")])

### Tables
Table(columns: Col[]) — Data table — column-oriented. Each Col holds its own data array.
Col(label: string, data: any, type?: "string" | "number" | "action") — Column definition — holds label + data array
EditableTable(name?: string, columns?: {type: "text" | "number" | "date-single" | "select" | "url", key?: string, header?: string, width?: number, options?: {value: string, label: string}[]}[], data?: {id: string, values: (string | number)[]}[]) — Spreadsheet-like table whose cells the user can edit inline (text, number, url, date, select columns); edits are saved back as a form field
- EditableTable lets the user edit cells inline. Give it a unique name, columns of { type, key, header } with type one of text | number | date-single | select | url (select also needs options: [{ value, label }]).
- data is an array of { id, values } rows where values are ordered positionally to match columns. Edited data is submitted when the user clicks Save Changes.
- Table is COLUMN-oriented: Table([Col("Label", dataArray), Col("Count", countArray, "number")]). Use array pluck for data: data.rows.fieldName
- Col data can be component arrays for styled cells: Col("Status", @Each(data.rows, "item", Tag(item.status, null, "sm", item.status == "open" ? "success" : "danger")))
- Row actions: Col("Actions", @Each(data.rows, "t", Button("Edit", Action([@Set($showEdit, true), @Set($editId, t.id)]))))
- Sortable: sorted = @Sort(data.rows, $sortField, "desc"). Bind $sortField to Select. Use sorted.fieldName for Col data
- Searchable: filtered = @Filter(data.rows, "title", "contains", $search). Bind $search to Input
- Chain sort + filter: filtered = @Filter(...) then sorted = @Sort(filtered, ...) — use sorted for both Table and Charts
- Empty state: @Count(data.rows) > 0 ? Table([...]) : TextContent("No data yet")

### Charts (2D)
BarChart(labels: string[], series: Series[], variant?: "grouped" | "stacked", xLabel?: string, yLabel?: string, height?: number) — Vertical bars; use for comparing values across categories with one or more series
LineChart(labels: string[], series: Series[], variant?: "linear" | "natural" | "step", xLabel?: string, yLabel?: string, height?: number) — Lines over categories; use for trends and continuous data over time
AreaChart(labels: string[], series: Series[], variant?: "linear" | "natural" | "step", xLabel?: string, yLabel?: string, height?: number) — Filled area under lines; use for cumulative totals or volume trends over time
RadarChart(labels: string[], series: Series[]) — Spider/web chart; use for comparing multiple variables across one or more entities
HorizontalBarChart(labels: string[], series: Series[], variant?: "grouped" | "stacked", xLabel?: string, yLabel?: string) — Horizontal bars; prefer when category labels are long or for ranked lists
Series(category: string, values: number[]) — One data series
- Charts accept column arrays: LineChart(labels, [Series("Name", values)]). Use array pluck: LineChart(data.rows.day, [Series("Views", data.rows.views)])
- Use Cards to wrap charts with CardHeader for titled sections
- Chart + Table from same source: use @Sort or @Filter result for both LineChart and Table Col data
- Multiple chart views: use Tabs — Tabs([TabItem("line", "Line", [LineChart(...)]), TabItem("bar", "Bar", [BarChart(...)])])

### Charts (1D)
PieChart(labels: string[], values: number[], variant?: "pie" | "donut", appearance?: "circular" | "semiCircular") — Circular slices; use plucked arrays: PieChart(data.categories, data.values)
RadialChart(labels: string[], values: number[]) — Radial bars; use plucked arrays: RadialChart(data.categories, data.values)
SingleStackedBarChart(labels: string[], values: number[]) — Single horizontal stacked bar; use plucked arrays: SingleStackedBarChart(data.categories, data.values)
Slice(category: string, value: number) — One slice with label and numeric value
- PieChart and BarChart need NUMBERS, not objects. For list data, use @Count(@Filter(...)) to aggregate:
- PieChart from list: `PieChart(["Low", "Med", "High"], [@Count(@Filter(data.rows, "priority", "==", "low")), @Count(@Filter(data.rows, "priority", "==", "medium")), @Count(@Filter(data.rows, "priority", "==", "high"))], "donut")`
- KPI from count: `TextContent("" + @Count(@Filter(data.rows, "status", "==", "open")), "large-heavy")`

### Charts (Scatter)
ScatterChart(datasets: ScatterSeries[], xLabel?: string, yLabel?: string) — X/Y scatter plot; use for correlations, distributions, and clustering
ScatterSeries(name: string, points: Point[]) — Named dataset
Point(x: number, y: number, z?: number) — Data point with numeric coordinates

### Forms
Form(name: string, buttons: Buttons, fields?: FormControl[]) — Form container with fields and explicit action buttons
FormControl(label: string, input: Input | TextArea | Select | DatePicker | Slider | CheckBoxGroup | RadioGroup | Chips | OptionCards, hint?: string) — Field with label, input component, and optional hint text
Label(text: string) — Text label
Input(name: string, placeholder?: string, type?: "text" | "email" | "password" | "number" | "url", rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>)
TextArea(name: string, placeholder?: string, rows?: number, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>)
Select(name: string, items: SelectItem[], placeholder?: string, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>, size?: "small" | "medium" | "large")
SelectItem(value: string, label: string) — Option for Select
DatePicker(name: string, mode?: "single" | "range", rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<any>)
Slider(name: string, variant: "continuous" | "discrete", min: number, max: number, step?: number, defaultValue?: number[], label?: string, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<number[]>) — Numeric slider input; supports continuous and discrete (stepped) variants
CheckBoxGroup(name: string, items: CheckBoxItem[], rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<Record<string, boolean>>)
CheckBoxItem(label: string, description: string, name: string, defaultChecked?: boolean)
RadioGroup(name: string, items: RadioItem[], defaultValue?: string, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>)
RadioItem(label: string, description: string, value: string)
SwitchGroup(name: string, items: SwitchItem[], variant?: "clear" | "card" | "sunk", value?: $binding<Record<string, boolean>>) — Group of switch toggles
SwitchItem(label?: string, description?: string, name: string, defaultChecked?: boolean) — Individual switch toggle
Chips(name: string, type?: "single" | "multiple", items?: ChipItem[], rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, defaultValue?: string | string[]) — A form field of compact selectable chips for choosing one or many short options; the selection is stored under `name`.
ChipItem(value: string, label: string, icon?: Icon, disabled?: boolean) — A single selectable chip inside a Chips group, with a value, label and optional icon.
OptionCards(name: string, type?: "single" | "multiple", items?: OptionCard[], rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, defaultValue?: string | string[]) — A form field of selectable cards (title, optional subtitle, optional icon or image) laid out in a responsive grid for choosing one or many options; the selection is stored under `name`.
OptionCard(value: string, title: string, subtitle?: string, topContent?: Icon | Image, disabled?: boolean) — A single selectable card inside an OptionCards group, with a value, title, optional subtitle and an optional Icon or Image on top.
- Chips: compact single/multiple selection pills. Use ChipItem references for each option.
- OptionCards: larger selectable cards with title, subtitle and an optional Icon or Image on top. Use OptionCard references for each option.
- For Form fields, define EACH FormControl as its own reference — do NOT inline all controls in one array. This allows progressive field-by-field streaming.
- NEVER nest Form inside Form — each Form should be a standalone container.
- Form requires explicit buttons. Always pass a Buttons(...) reference as the third Form argument.
- rules is an optional object: {required: true, email: true, minLength: 8, maxLength: 100}
- Available rules: required, email, min, max, minLength, maxLength, pattern, url, numeric
- The renderer shows error messages automatically — do NOT generate error text in the UI
- Conditional fields: $country == "US" ? stateField : $country == "UK" ? postcodeField : addressField
- Edit form in Modal: Modal("Edit", $showEdit, [Form("edit", Buttons([saveBtn, cancelBtn]), [fields...])]). Save button should include @Set($showEdit, false) to close modal.

### Buttons
Button(label: string, action?: ActionExpression, variant?: "primary" | "secondary" | "tertiary", type?: "normal" | "destructive", size?: "extra-small" | "small" | "medium" | "large") — Clickable button
Buttons(buttons: Button[], direction?: "row" | "column") — Group of Button components. direction: "row" (default) | "column".
IconButton(name: string, icon: Icon, action?: ActionExpression, variant?: "primary" | "secondary" | "tertiary", size?: "extra-small" | "small" | "medium" | "large", shape?: "square" | "circle") — Icon-only button. name is the accessible label and the action label; icon is an Icon; action fires on click.
- Icon renders a lucide icon by kebab-case name; it is also used as the icon of IconButton, IconText and OptionCard.
- Toggle in @Each: @Each(rows, "t", Button(t.status == "open" ? "Close" : "Reopen", Action([...])))

### Data Display
TagBlock(tags: string[], size?: "sm" | "md" | "lg") — tags is an array of strings; optional size sm | md | lg
Tag(text: string, icon?: Icon, size?: "sm" | "md" | "lg", variant?: "neutral" | "info" | "success" | "warning" | "danger") — Styled tag/badge with optional Icon and variant
Icon(name: string, category?: string) — A lucide icon by kebab-case name (e.g. 'circle-check'). Optional category picks a topical fallback when the name doesn't resolve.
EntityList(rows?: {left: string, right: string, rightVariant?: "text" | "number"}[], size?: "small" | "default", header?: {left: string, right: string, rightVariant?: "text" | "number"}, footer?: {left: string, right: string, rightVariant?: "text" | "number"}) — Two-column key/value rows (left label, right value). size 'default' supports optional header and footer rows; rightVariant 'number' uses tabular numbers.
ListBlock(items: ListItem[], variant?: "number" | "image", size?: "default" | "small") — A list of items with number or image indicators. Each item can optionally have an action. size small renders a compact list.
ListItem(title: string, subtitle?: string, image?: {src: string, alt: string}, actionLabel?: string, action?: ActionExpression) — Item in a ListBlock — displays a title with an optional subtitle and image. When action is provided, the item becomes clickable.
- Color-mapped Tag: Tag(value, null, "sm", value == "high" ? "danger" : value == "medium" ? "warning" : "neutral")
- EntityList is a compact two-column list of { left, right } rows (e.g. name / value). size='default' also supports a header and footer row; size='small' does not.
- ListBlock is a numbered or image list of ListItem references. An action on ListItem is optional.

### Cards
SnippetCardBlock(items: SnippetCardItem[], layout?: "grid", responsive?: boolean, action?: ActionExpression, gap?: number | string) — A responsive grid of compact label/value cards (2 per row) for showing several short facts side by side; optionally clickable with a shared action.
SnippetCardItem(id?: string, lhs: IconText | ImageText, rhs?: Text | BoldText) — One row-style snippet card: a label on the left (IconText or ImageText) and an optional value on the right (Text or BoldText).
OverviewCardBlock(items: OverviewCardItem[], layout?: "grid" | "carousel", responsive?: boolean, action?: ActionExpression, gap?: number | string) — A grid or horizontal carousel of compact overview cards, each with a heading (icon/image/text) on top and an inline metric below; optionally clickable with a shared action.
OverviewCardItem(id?: string, top: IconText | ImageText | Text, bottom?: MetricIndicatorInline) — One overview card: a heading slot at the top (IconText, ImageText or Text) and an optional MetricIndicatorInline at the bottom.
ContextCardBlock(items: ContextCardItem[], layout?: "grid" | "carousel", responsive?: boolean, action?: ActionExpression, gap?: number | string) — A grid or carousel of compact tinted context cards (title or tag plus a short bold body); an optional action makes every card clickable.
ContextCardItem(id?: string, title: string | Tag, body?: string, bgColor?: "gray", bgImageSrc?: string, bgImageAlt?: string) — A single card inside a ContextCardBlock: a title (plain string or Tag), an optional markdown body, and an optional gray tint or background image.
CompositeCardBlock(items: CompositeCardItem[], layout?: "grid" | "carousel", responsive?: boolean, action?: ActionExpression, gap?: number | string) — A two-per-row grid or carousel of rich cards, each with an optional header, stacked body content (text, metrics, charts, lists, tags) and a price/button footer; an optional action makes every card clickable.
CompositeCardItem(id?: string, header?: IconText | ImageText | ImageTextLarge | Text | Image, body?: (Text | BoldText | MetricIndicatorInline | IconText | Image | AreaChart | BarChart | LineChart | ListBlock | TagBlock | EntityList)[], footer?: {price?: BoldText | MetricIndicatorWithStrikethrough, button?: Button}) — A single card inside a CompositeCardBlock: an optional header (icon/image/text), a stack of body elements (text, metrics, charts, lists, tags), and an optional price/button footer.
VisualCardBlock(items: VisualCardItem[], layout?: "grid" | "carousel", responsive?: boolean, action?: ActionExpression, gap?: number | string) — A grid or carousel of photo-first cards: a full-bleed background image with a tag on top and a bold text panel at the bottom; an optional action makes every card clickable.
VisualCardItem(body: BoldText, id?: string, bgImageSrc?: string, tag?: Tag, bgImageAlt?: string) — A single photo-first card inside a VisualCardBlock: a BoldText body panel, an optional Tag, and a background image (bgImageSrc must be a real URL; bgImageAlt is its alt text).
Text(variant?: "text" | "number", value: string, subtext?: string, subtextVariant?: "text" | "number" | "metric", size?: "xs" | "sm" | "md" | "lg") — Plain text line with optional subtext. variant 'number' uses tabular number styling; subtextVariant 'metric' colors a leading +/- subtext green/red.
BoldText(variant?: "text" | "number", value: string, subtext?: string, subtextVariant?: "text" | "number" | "metric", size?: "xs" | "sm" | "md" | "lg") — Emphasized (bold) text line with optional subtext. variant 'number' uses tabular number styling; subtextVariant 'metric' colors a leading +/- subtext green/red.
IconText(icon: Icon, iconVariant?: "neutral" | "info" | "success" | "warning" | "danger" | "inverted" | "filled" | "soft", iconSize?: "xs" | "s" | "m" | "l" | "xl" | "sm" | "md" | "lg", title: string, subtitle?: string, bold?: boolean, layout?: "horizontal" | "vertical") — An icon badge with a title and optional subtitle, laid out horizontally or vertically. iconVariant sets the badge color.
ImageText(src: string, alt?: string, title: string, subtitle?: string, bold?: boolean, layout?: "horizontal" | "vertical", imageSize?: number) — A small square image (thumbnail/avatar) with a title and optional subtitle. src must be a real image URL.
ImageTextLarge(src: string, alt?: string, title: string, subtitle?: string, bold?: boolean) — A full-width banner image above a bold title and optional subtitle. src must be a real image URL.
MetricIndicatorInline(value: string, subtext?: string, trend?: {direction: "up" | "down", value: number}) — Headline metric value with an optional +/- percentage trend and subtext, all on one line.
MetricIndicatorWithStrikethrough(value: string, subtext?: string, previousValue?: string, trend?: {direction: "up" | "down", value: number}) — Headline metric value with an optional struck-through previousValue, a +/- percentage trend, and subtext below.
- Card blocks lay out 2+ items in a responsive grid (or carousel where supported). Every item in a block must have the same structure.
- SnippetCardItem: small card with lhs (IconText | ImageText) and optional rhs (Text | BoldText) — good for key/value facts.
- OverviewCardItem: small card with top (IconText | ImageText | Text) and optional bottom MetricIndicatorInline — good for KPIs.
- ContextCardItem: medium card with a title (string or Tag), body text and optional background image — good for summaries.
- CompositeCardItem: rich card with header, body array (Text, BoldText, MetricIndicatorInline, IconText, Image, charts, ListBlock, TagBlock, EntityList) and footer (price + Button) — good for products/offers.
- VisualCardItem: image-first card with a BoldText body and optional Tag.
- Text / BoldText / IconText / ImageText / ImageTextLarge / MetricIndicator* are the inline building blocks used INSIDE card items; do not place them directly in the root Card.

### Other
Chart(type: "bar" | "line" | "area" | "pie" | "donut" | "scatter", data: Record<string, string | number>[], x?: string, series?: string[], format?: "number" | "currency" | "percent", currency?: string, stacked?: boolean, height?: number) — Rows of data; x is the category key (a number key for scatter), series the value keys (default: every number key). percent values are like 45; currency is a code like "EUR".
Map(center?: string, zoom?: number, markers?: {position: string, label?: string}[], paths?: {points: string[], color?: string, weight?: number}[], height?: number) — Geographic map (AMap) for locations and routes: center is "lng,lat" (GCJ-02), zoom 3-18; markers are {position: "lng,lat", label?}; paths are {points: ["lng,lat", ...], color?, weight?}. Keep 12 markers or fewer and 3 paths or fewer so the map stays readable on phones.
Svg(children: Node[], viewBox: string, width?: Length, height?: Length) — A drawing for steps, parts, mechanisms, diagrams and layouts. Scales to its width; its shapes take expressions, so state can move them.
Circle(cx: number, cy: number, r: number, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)
Ellipse(cx: number, cy: number, rx: number, ry: number, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)
Rect(x: number, y: number, width: number, height: number, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number, rx?: number)
Line(x1: number, y1: number, x2: number, y2: number, stroke?: Color, strokeWidth?: number, opacity?: number)
Path(d: string, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)
Polyline(points: string, stroke?: Color, strokeWidth?: number, fill?: Color, opacity?: number) — points like "0,0 10,5 20,0".
Polygon(points: string, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)
G(children: Node[], transform?: string, opacity?: number) — Group; transform like "rotate(30 50 50)" or "translate(10 0)".
SvgText(text: string, x: number, y: number, size?: number, fill?: Color, anchor?: "start" | "middle" | "end", weight?: "normal" | "medium" | "semibold")
HtmlView(html: string, height?: number, title?: string) — Sandboxed HTML page with inline JS, for games and canvas. No network except script CDNs. Fits its content unless height is set.

## Built-in Functions

@Append(list: any[], item: any) → any[] — Copy of the list with item added at the end
@Prepend(list: any[], item: any) → any[] — Copy of the list with item added at the start
@Concat(list: any[], more: any[]) → any[] — Joins two lists
@Remove(list: any[], field: string, value: any) → any[] — Copy without the items whose field equals value; field "" compares the items themselves
@RemoveAt(list: any[], index: number) → any[] — Copy without the item at index (0-based; negative counts from the end)
@Update(list: any[], field: string, value: any, setField: string, setValue: any) → any[] — Copy where items whose field equals value get setField set to setValue
@Toggle(list: any[], item: any) → any[] — Adds item if missing, removes it if present (a set of strings or numbers)
@Includes(list: any[] | string, item: any) → boolean — True if the list has item, or the text contains it
@Find(list: any[], field: string, value: any) → any — First item whose field equals value, or null
@IndexOf(list: any[], item: any) → number — Index of item in the list, or -1
@Take(list: any[], n: number) → any[] — The first n items; a negative n takes the last n
@SliceList(list: any[] | string, start: number, end?: number) → any[] | string — Items, or characters of text, from start up to end (not included); negative counts from the end
@Unique(list: any[]) → any[] — Distinct items in first-seen order
@Reverse(list: any[]) → any[] — Copy in reverse order
@Range(start: number, end: number, step?: number) → number[] — Numbers from start up to end (not included) by step (default 1), e.g. @Range(0, 3) is [0, 1, 2]
@Pick(list: any[]) → any — A random item, or null for an empty list; draws anew each time, so call it inside @Set
@Shuffle(list: any[]) → any[] — Copy in random order; call it inside @Set
@Flatten(list: any[]) → any[] — One list from a list of lists, e.g. [[1, 2], [3]] is [1, 2, 3]
@Chunk(list: any[], size: number) → any[][] — The list cut into lists of size items, e.g. for weeks of 7 days or pages
@Pow(base: number, exponent: number) → number — base raised to exponent
@Sqrt(number: number) → number — Square root; null for a negative number
@Random(min: number, max: number, integer?: boolean) → number — Random number from min to max (integer true: a whole number, max included); draws anew each time, so call it inside @Set
@Clamp(number: number, min: number, max: number) → number — number kept between min and max
@Percent(part: number, total: number) → number — part / total * 100, e.g. @Percent(3, 4) is 75; 0 when total is 0
@Lerp(a: number, b: number, t: number) → number — The value a fraction t of the way from a to b
@Allocate(total: number, weights: number[], decimals?: number) → number[] — Splits total in proportion to weights, rounded to decimals (default 2), so the parts add up to exactly total, e.g. @Allocate(100, [1, 1, 1]) is [33.34, 33.33, 33.33]
@Payment(principal: number, rate: number, periods: number) → number — Payment per period that repays principal over periods at rate percent per period, e.g. a 30-year loan at 6% a year: @Payment(300000, 6 / 12, 360)
@Convert(value: number, from: string, to: string) → number — value from one unit to another: mm cm m km in ft yd mi; mg g kg oz lb st; ml l tsp tbsp floz cup pt qt gal (US); m/s km/h mph kn; m2 km2 ft2 ha acre; c f k
@Format(value: number, kind?: "number" | "currency" | "percent" | "compact", decimals?: number, currency?: string) → string — Number as text: "number" 12,345.6, "currency" $12,345.68 (currency is a code like "EUR"), "percent" 45 -> 45%, "compact" 1.2M ($1.2M with a currency)
@Join(list: any[], sep?: string, field?: string) → string — Joins the items (or their field) into text with sep (default ", "), skipping nulls
@Plural(n: number, word: string, plural?: string) → string — Count and word: @Plural(1, "guest") is "1 guest", 3 gives "3 guests"; plural defaults to word + "s"
@Pad(value: string | number, length: number, char?: string) → string — Pads the start of value to length with char (default "0"), e.g. 7 -> "07"
@Upper(text: string) → string — Text in upper case
@Lower(text: string) → string — Text in lower case
@Trim(text: string) → string — Text without spaces at the start and end
@Capitalize(text: string) → string — Each word with a capital first letter, e.g. "new york" is "New York"
@Split(text: string, sep?: string) → string[] — List of the parts of text between sep (default ","), each trimmed, empty parts dropped, e.g. @Split("a, b,,c") is ["a", "b", "c"]
@Replace(text: string, find: string, replacement: string) → string — Text with every find replaced by replacement
@Duration(seconds: number, style?: "short" | "clock") → string — Seconds as text: "short" 1h 20m, 4m 05s, 45s (default); "clock" 1:20:00, 4:05
@Default(value?: any, fallback: any) → any — value, or fallback when value is null, "" or not a number, e.g. an empty number input: @Default($weight, 0)
@MixColor(from: string, to: string, t: number) → string — The hex color a fraction t of the way from one hex color to another, e.g. @MixColor("#ffffff", "#0285ff", 0.5) for a heatmap or a tint
@Now() → string — The current date and time as an ISO string
@Today() → string — Today's date in the viewer's time zone, as "YYYY-MM-DD"
@FormatDate(date: string | number, style?: "date" | "short" | "long" | "weekday" | "month" | "time" | "datetime" | "iso") → string — A date as text: "date" Oct 9, 2026 (default), "short" Oct 9, "long" Friday, October 9, 2026, "weekday" Fri, "month" Oct 2026, "time" 9:30 PM, "datetime", "iso" 2026-10-09. Dates are "YYYY-MM-DD", ISO or a timestamp
@AddDays(date: string | number, days: number) → string — The date days later (negative: earlier), as "YYYY-MM-DD"
@AddMonths(date: string | number, months: number) → string — The date months later (negative: earlier), kept within the month (Jan 31 + 1 is Feb 28), as "YYYY-MM-DD"; 12 months is a year
@DaysBetween(from: string | number, to: string | number) → number — Calendar days from one date to another (negative if to is earlier)
@MonthsBetween(from: string | number, to: string | number) → number — Whole months from one date to another (negative if to is earlier); @Floor(@MonthsBetween(birthday, @Today()) / 12) is an age
@StartOf(date: string | number, unit: "week" | "month" | "year") → string — First day of the date's "week" (Monday), "month" or "year", as "YYYY-MM-DD"
@GroupBy(rows: any[], key: string, field?: string, agg?: "sum" | "avg" | "count" | "min" | "max") → {key: string | number, value: number}[] — One row per distinct key, in first-seen order; value is agg of field (default "sum"), or the row count without a field
@Pivot(rows: any[], rowKey: string, colKey: string, field?: string, agg?: "sum" | "avg" | "count" | "min" | "max") → Record<string, string | number>[] — One row per rowKey value with a column per colKey value holding agg of field, for stacked or grouped charts
@Top(rows: any[], field: string, n: number, direction?: "desc" | "asc") → any[] — The n rows with the largest field ("asc": the smallest)
@Between(rows: any[], field: string, min?: any, max?: any) → any[] — Rows whose field is from min to max, both included; compares numbers, or text such as "YYYY-MM-DD" dates. Leave min or max null for an open end
@Bucket(rows: any[], dateField: string, unit: "day" | "week" | "month", field?: string, agg?: "sum" | "avg" | "count" | "min" | "max") → {key: string | number, value: number}[] — Rows per day, week (from Monday) or month of dateField, in date order, empty periods 0 for sum and count; key is "YYYY-MM-DD", or "YYYY-MM" for months
@Cumulative(rows: any[], field: string) → any[] — Copy of the rows with field replaced by its running total (field "" for a list of numbers)
@MovingAvg(rows: any[], field: string, window: number) → any[] — Copy of the rows with field replaced by the average of its last window values (field "" for a list of numbers)
@Change(current: number, previous: number) → number — Percent change from previous to current, e.g. @Change(120, 100) is 20; null when previous is 0
@Histogram(values: number[], bins: number, min?: number, max?: number) → {key: string, value: number, start: number, end: number}[] — Counts numbers into equal-width bins (value is the count); min and max fix the range, default the data's
@Stats(values: number[]) → {count: number, min: number, max: number, mean: number, median: number, stdev: number} — Summary of numbers, all zeros for an empty list
