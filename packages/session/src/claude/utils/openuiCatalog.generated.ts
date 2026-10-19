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
 * ⚠️ 生成文件——勿手改。重生成：bun run packages/session/scripts/generate-openui-prompt.ts
 * 来源：@openuidev/react-ui openuiLibrary（核心子集经 generateSystemPrompt 重建；
 * 选项单一来源在脚本 OPENUI_CORE_PROMPT_OPTIONS；全量目录在 openui skill）
 */

/**
 * ⚠️ 生成文件——勿手改。重生成：bun run packages/session/scripts/generate-openui-prompt.ts
 * 来源：@openuidev/react-ui openuiLibrary 全量 toSpec()（95 组件 + 59 函数），
 * 消费方：openui_components MCP 工具（签名按需检索，组件+函数双目录）
 */

export interface OpenUiCatalogEntry {
    name: string
    signature: string
    description: string
}

export const OPENUI_COMPONENT_CATALOG: readonly OpenUiCatalogEntry[] = [
  {
    "name": "Card",
    "signature": "Card(children: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Form | Buttons | IconButton | Steps | InlineHeader | EntityList | EditableTable | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock | Tabs | Carousel | Stack)[], variant?: \"card\" | \"sunk\" | \"clear\", direction?: \"row\" | \"column\", gap?: \"none\" | \"xs\" | \"s\" | \"m\" | \"l\" | \"xl\" | \"2xl\", align?: \"start\" | \"center\" | \"end\" | \"stretch\" | \"baseline\", justify?: \"start\" | \"center\" | \"end\" | \"between\" | \"around\" | \"evenly\", wrap?: boolean)",
    "description": "Styled container. variant: \"card\" (default, elevated) | \"sunk\" (recessed) | \"clear\" (transparent). Always full width. Accepts all Stack flex params (default: direction \"column\"). Cards flex to share space in row/wrap layouts."
  },
  {
    "name": "CardHeader",
    "signature": "CardHeader(title?: string, subtitle?: string)",
    "description": "Header with optional title and subtitle"
  },
  {
    "name": "TextContent",
    "signature": "TextContent(text: string, size?: \"small\" | \"default\" | \"large\" | \"small-heavy\" | \"large-heavy\")",
    "description": "Text block. Supports markdown. Optional size: \"small\" | \"default\" | \"large\" | \"small-heavy\" | \"large-heavy\"."
  },
  {
    "name": "MarkDownRenderer",
    "signature": "MarkDownRenderer(textMarkdown: string, variant?: \"clear\" | \"card\" | \"sunk\")",
    "description": "Renders markdown text with optional container variant"
  },
  {
    "name": "Callout",
    "signature": "Callout(variant: \"info\" | \"warning\" | \"error\" | \"success\" | \"neutral\", title: string, description: string, visible?: $binding<boolean>)",
    "description": "Callout banner. Optional visible is a reactive $boolean — auto-dismisses after 3s by setting $visible to false."
  },
  {
    "name": "TextCallout",
    "signature": "TextCallout(variant?: \"neutral\" | \"info\" | \"warning\" | \"success\" | \"danger\", title?: string, description?: string)",
    "description": "Text callout with variant, title, and description"
  },
  {
    "name": "Image",
    "signature": "Image(alt: string, src?: string)",
    "description": "Image with alt text and optional URL"
  },
  {
    "name": "ImageBlock",
    "signature": "ImageBlock(src: string, alt?: string)",
    "description": "Image block with loading state"
  },
  {
    "name": "ImageGallery",
    "signature": "ImageGallery(images: {src: string, alt?: string, details?: string}[])",
    "description": "Gallery grid of images with modal preview"
  },
  {
    "name": "CodeBlock",
    "signature": "CodeBlock(language: string, codeString: string)",
    "description": "Syntax-highlighted code block"
  },
  {
    "name": "InlineHeader",
    "signature": "InlineHeader(heading: string, description?: string)",
    "description": "Compact section heading with an optional one-line description, for use inside cards."
  },
  {
    "name": "Table",
    "signature": "Table(columns: Col[])",
    "description": "Data table — column-oriented. Each Col holds its own data array."
  },
  {
    "name": "Col",
    "signature": "Col(label: string, data: any, type?: \"string\" | \"number\" | \"action\")",
    "description": "Column definition — holds label + data array"
  },
  {
    "name": "EditableTable",
    "signature": "EditableTable(name?: string, columns?: {type: \"text\" | \"number\" | \"date-single\" | \"select\" | \"url\", key?: string, header?: string, width?: number, options?: {value: string, label: string}[]}[], data?: {id: string, values: (string | number)[]}[])",
    "description": "Spreadsheet-like table whose cells the user can edit inline (text, number, url, date, select columns); edits are saved back as a form field"
  },
  {
    "name": "BarChart",
    "signature": "BarChart(labels: string[], series: Series[], variant?: \"grouped\" | \"stacked\", xLabel?: string, yLabel?: string, height?: number)",
    "description": "Vertical bars; use for comparing values across categories with one or more series"
  },
  {
    "name": "LineChart",
    "signature": "LineChart(labels: string[], series: Series[], variant?: \"linear\" | \"natural\" | \"step\", xLabel?: string, yLabel?: string, height?: number)",
    "description": "Lines over categories; use for trends and continuous data over time"
  },
  {
    "name": "AreaChart",
    "signature": "AreaChart(labels: string[], series: Series[], variant?: \"linear\" | \"natural\" | \"step\", xLabel?: string, yLabel?: string, height?: number)",
    "description": "Filled area under lines; use for cumulative totals or volume trends over time"
  },
  {
    "name": "RadarChart",
    "signature": "RadarChart(labels: string[], series: Series[])",
    "description": "Spider/web chart; use for comparing multiple variables across one or more entities"
  },
  {
    "name": "HorizontalBarChart",
    "signature": "HorizontalBarChart(labels: string[], series: Series[], variant?: \"grouped\" | \"stacked\", xLabel?: string, yLabel?: string)",
    "description": "Horizontal bars; prefer when category labels are long or for ranked lists"
  },
  {
    "name": "Series",
    "signature": "Series(category: string, values: number[])",
    "description": "One data series"
  },
  {
    "name": "PieChart",
    "signature": "PieChart(labels: string[], values: number[], variant?: \"pie\" | \"donut\", appearance?: \"circular\" | \"semiCircular\")",
    "description": "Circular slices; use plucked arrays: PieChart(data.categories, data.values)"
  },
  {
    "name": "RadialChart",
    "signature": "RadialChart(labels: string[], values: number[])",
    "description": "Radial bars; use plucked arrays: RadialChart(data.categories, data.values)"
  },
  {
    "name": "SingleStackedBarChart",
    "signature": "SingleStackedBarChart(labels: string[], values: number[])",
    "description": "Single horizontal stacked bar; use plucked arrays: SingleStackedBarChart(data.categories, data.values)"
  },
  {
    "name": "Slice",
    "signature": "Slice(category: string, value: number)",
    "description": "One slice with label and numeric value"
  },
  {
    "name": "ScatterChart",
    "signature": "ScatterChart(datasets: ScatterSeries[], xLabel?: string, yLabel?: string)",
    "description": "X/Y scatter plot; use for correlations, distributions, and clustering"
  },
  {
    "name": "ScatterSeries",
    "signature": "ScatterSeries(name: string, points: Point[])",
    "description": "Named dataset"
  },
  {
    "name": "Point",
    "signature": "Point(x: number, y: number, z?: number)",
    "description": "Data point with numeric coordinates"
  },
  {
    "name": "Form",
    "signature": "Form(name: string, buttons: Buttons, fields?: FormControl[])",
    "description": "Form container with fields and explicit action buttons"
  },
  {
    "name": "FormControl",
    "signature": "FormControl(label: string, input: Input | TextArea | Select | DatePicker | Slider | CheckBoxGroup | RadioGroup | Chips | OptionCards, hint?: string)",
    "description": "Field with label, input component, and optional hint text"
  },
  {
    "name": "Label",
    "signature": "Label(text: string)",
    "description": "Text label"
  },
  {
    "name": "Input",
    "signature": "Input(name: string, placeholder?: string, type?: \"text\" | \"email\" | \"password\" | \"number\" | \"url\", rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>)",
    "description": ""
  },
  {
    "name": "TextArea",
    "signature": "TextArea(name: string, placeholder?: string, rows?: number, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>)",
    "description": ""
  },
  {
    "name": "Select",
    "signature": "Select(name: string, items: SelectItem[], placeholder?: string, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>, size?: \"small\" | \"medium\" | \"large\")",
    "description": ""
  },
  {
    "name": "SelectItem",
    "signature": "SelectItem(value: string, label: string)",
    "description": "Option for Select"
  },
  {
    "name": "DatePicker",
    "signature": "DatePicker(name: string, mode?: \"single\" | \"range\", rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<any>)",
    "description": ""
  },
  {
    "name": "Slider",
    "signature": "Slider(name: string, variant: \"continuous\" | \"discrete\", min: number, max: number, step?: number, defaultValue?: number[], label?: string, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<number[]>)",
    "description": "Numeric slider input; supports continuous and discrete (stepped) variants"
  },
  {
    "name": "CheckBoxGroup",
    "signature": "CheckBoxGroup(name: string, items: CheckBoxItem[], rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<Record<string, boolean>>)",
    "description": ""
  },
  {
    "name": "CheckBoxItem",
    "signature": "CheckBoxItem(label: string, description: string, name: string, defaultChecked?: boolean)",
    "description": ""
  },
  {
    "name": "RadioGroup",
    "signature": "RadioGroup(name: string, items: RadioItem[], defaultValue?: string, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>)",
    "description": ""
  },
  {
    "name": "RadioItem",
    "signature": "RadioItem(label: string, description: string, value: string)",
    "description": ""
  },
  {
    "name": "SwitchGroup",
    "signature": "SwitchGroup(name: string, items: SwitchItem[], variant?: \"clear\" | \"card\" | \"sunk\", value?: $binding<Record<string, boolean>>)",
    "description": "Group of switch toggles"
  },
  {
    "name": "SwitchItem",
    "signature": "SwitchItem(label?: string, description?: string, name: string, defaultChecked?: boolean)",
    "description": "Individual switch toggle"
  },
  {
    "name": "ChipItem",
    "signature": "ChipItem(value: string, label: string, icon?: Icon, disabled?: boolean)",
    "description": "A single selectable chip inside a Chips group, with a value, label and optional icon."
  },
  {
    "name": "Chips",
    "signature": "Chips(name: string, type?: \"single\" | \"multiple\", items?: ChipItem[], rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, defaultValue?: string | string[])",
    "description": "A form field of compact selectable chips for choosing one or many short options; the selection is stored under `name`."
  },
  {
    "name": "OptionCard",
    "signature": "OptionCard(value: string, title: string, subtitle?: string, topContent?: Icon | Image, disabled?: boolean)",
    "description": "A single selectable card inside an OptionCards group, with a value, title, optional subtitle and an optional Icon or Image on top."
  },
  {
    "name": "OptionCards",
    "signature": "OptionCards(name: string, type?: \"single\" | \"multiple\", items?: OptionCard[], rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, defaultValue?: string | string[])",
    "description": "A form field of selectable cards (title, optional subtitle, optional icon or image) laid out in a responsive grid for choosing one or many options; the selection is stored under `name`."
  },
  {
    "name": "Button",
    "signature": "Button(label: string, action?: ActionExpression, variant?: \"primary\" | \"secondary\" | \"tertiary\", type?: \"normal\" | \"destructive\", size?: \"extra-small\" | \"small\" | \"medium\" | \"large\")",
    "description": "Clickable button"
  },
  {
    "name": "Buttons",
    "signature": "Buttons(buttons: Button[], direction?: \"row\" | \"column\")",
    "description": "Group of Button components. direction: \"row\" (default) | \"column\"."
  },
  {
    "name": "IconButton",
    "signature": "IconButton(name: string, icon: Icon, action?: ActionExpression, variant?: \"primary\" | \"secondary\" | \"tertiary\", size?: \"extra-small\" | \"small\" | \"medium\" | \"large\", shape?: \"square\" | \"circle\")",
    "description": "Icon-only button. name is the accessible label and the action label; icon is an Icon; action fires on click."
  },
  {
    "name": "Stack",
    "signature": "Stack(children: any[], direction?: \"row\" | \"column\", gap?: \"none\" | \"xs\" | \"s\" | \"m\" | \"l\" | \"xl\" | \"2xl\", align?: \"start\" | \"center\" | \"end\" | \"stretch\" | \"baseline\", justify?: \"start\" | \"center\" | \"end\" | \"between\" | \"around\" | \"evenly\", wrap?: boolean)",
    "description": "Flex container. direction: \"row\"|\"column\" (default \"column\"). gap: \"none\"|\"xs\"|\"s\"|\"m\"|\"l\"|\"xl\"|\"2xl\" (default \"m\"). align: \"start\"|\"center\"|\"end\"|\"stretch\"|\"baseline\". justify: \"start\"|\"center\"|\"end\"|\"between\"|\"around\"|\"evenly\"."
  },
  {
    "name": "Tabs",
    "signature": "Tabs(items: TabItem[])",
    "description": "Tabbed container"
  },
  {
    "name": "TabItem",
    "signature": "TabItem(value: string, trigger: string, content: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Form | Buttons | IconButton | Steps | InlineHeader | EntityList | EditableTable | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[])",
    "description": "value is unique id, trigger is tab label, content is array of components"
  },
  {
    "name": "Accordion",
    "signature": "Accordion(items: AccordionItem[])",
    "description": "Collapsible sections"
  },
  {
    "name": "AccordionItem",
    "signature": "AccordionItem(value: string, trigger: string, content: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Form | Buttons | IconButton | Steps | InlineHeader | EntityList | EditableTable | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[])",
    "description": "value is unique id, trigger is section title"
  },
  {
    "name": "Steps",
    "signature": "Steps(items: StepsItem[])",
    "description": "Step-by-step guide"
  },
  {
    "name": "StepsItem",
    "signature": "StepsItem(title: string, details: string)",
    "description": "title and details text for one step"
  },
  {
    "name": "Carousel",
    "signature": "Carousel(children: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Form | Buttons | IconButton | Steps | InlineHeader | EntityList | EditableTable | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[][], variant?: \"card\" | \"sunk\")",
    "description": "Horizontal scrollable carousel"
  },
  {
    "name": "Separator",
    "signature": "Separator(orientation?: \"horizontal\" | \"vertical\", decorative?: boolean)",
    "description": "Visual divider between content sections"
  },
  {
    "name": "TagBlock",
    "signature": "TagBlock(tags: string[], size?: \"sm\" | \"md\" | \"lg\")",
    "description": "tags is an array of strings; optional size sm | md | lg"
  },
  {
    "name": "Tag",
    "signature": "Tag(text: string, icon?: Icon, size?: \"sm\" | \"md\" | \"lg\", variant?: \"neutral\" | \"info\" | \"success\" | \"warning\" | \"danger\")",
    "description": "Styled tag/badge with optional Icon and variant"
  },
  {
    "name": "Icon",
    "signature": "Icon(name: string, category?: string)",
    "description": "A lucide icon by kebab-case name (e.g. 'circle-check'). Optional category picks a topical fallback when the name doesn't resolve."
  },
  {
    "name": "EntityList",
    "signature": "EntityList(rows?: {left: string, right: string, rightVariant?: \"text\" | \"number\"}[], size?: \"small\" | \"default\", header?: {left: string, right: string, rightVariant?: \"text\" | \"number\"}, footer?: {left: string, right: string, rightVariant?: \"text\" | \"number\"})",
    "description": "Two-column key/value rows (left label, right value). size 'default' supports optional header and footer rows; rightVariant 'number' uses tabular numbers."
  },
  {
    "name": "ListBlock",
    "signature": "ListBlock(items: ListItem[], variant?: \"number\" | \"image\", size?: \"default\" | \"small\")",
    "description": "A list of items with number or image indicators. Each item can optionally have an action. size small renders a compact list."
  },
  {
    "name": "ListItem",
    "signature": "ListItem(title: string, subtitle?: string, image?: {src: string, alt: string}, actionLabel?: string, action?: ActionExpression)",
    "description": "Item in a ListBlock — displays a title with an optional subtitle and image. When action is provided, the item becomes clickable."
  },
  {
    "name": "Text",
    "signature": "Text(variant?: \"text\" | \"number\", value: string, subtext?: string, subtextVariant?: \"text\" | \"number\" | \"metric\", size?: \"xs\" | \"sm\" | \"md\" | \"lg\")",
    "description": "Plain text line with optional subtext. variant 'number' uses tabular number styling; subtextVariant 'metric' colors a leading +/- subtext green/red."
  },
  {
    "name": "BoldText",
    "signature": "BoldText(variant?: \"text\" | \"number\", value: string, subtext?: string, subtextVariant?: \"text\" | \"number\" | \"metric\", size?: \"xs\" | \"sm\" | \"md\" | \"lg\")",
    "description": "Emphasized (bold) text line with optional subtext. variant 'number' uses tabular number styling; subtextVariant 'metric' colors a leading +/- subtext green/red."
  },
  {
    "name": "IconText",
    "signature": "IconText(icon: Icon, iconVariant?: \"neutral\" | \"info\" | \"success\" | \"warning\" | \"danger\" | \"inverted\" | \"filled\" | \"soft\", iconSize?: \"xs\" | \"s\" | \"m\" | \"l\" | \"xl\" | \"sm\" | \"md\" | \"lg\", title: string, subtitle?: string, bold?: boolean, layout?: \"horizontal\" | \"vertical\")",
    "description": "An icon badge with a title and optional subtitle, laid out horizontally or vertically. iconVariant sets the badge color."
  },
  {
    "name": "ImageText",
    "signature": "ImageText(src: string, alt?: string, title: string, subtitle?: string, bold?: boolean, layout?: \"horizontal\" | \"vertical\", imageSize?: number)",
    "description": "A small square image (thumbnail/avatar) with a title and optional subtitle. src must be a real image URL."
  },
  {
    "name": "ImageTextLarge",
    "signature": "ImageTextLarge(src: string, alt?: string, title: string, subtitle?: string, bold?: boolean)",
    "description": "A full-width banner image above a bold title and optional subtitle. src must be a real image URL."
  },
  {
    "name": "MetricIndicatorInline",
    "signature": "MetricIndicatorInline(value: string, subtext?: string, trend?: {direction: \"up\" | \"down\", value: number})",
    "description": "Headline metric value with an optional +/- percentage trend and subtext, all on one line."
  },
  {
    "name": "MetricIndicatorWithStrikethrough",
    "signature": "MetricIndicatorWithStrikethrough(value: string, subtext?: string, previousValue?: string, trend?: {direction: \"up\" | \"down\", value: number})",
    "description": "Headline metric value with an optional struck-through previousValue, a +/- percentage trend, and subtext below."
  },
  {
    "name": "SnippetCardItem",
    "signature": "SnippetCardItem(id?: string, lhs: IconText | ImageText, rhs?: Text | BoldText)",
    "description": "One row-style snippet card: a label on the left (IconText or ImageText) and an optional value on the right (Text or BoldText)."
  },
  {
    "name": "SnippetCardBlock",
    "signature": "SnippetCardBlock(items: SnippetCardItem[], layout?: \"grid\", responsive?: boolean, action?: ActionExpression, gap?: number | string)",
    "description": "A responsive grid of compact label/value cards (2 per row) for showing several short facts side by side; optionally clickable with a shared action."
  },
  {
    "name": "OverviewCardItem",
    "signature": "OverviewCardItem(id?: string, top: IconText | ImageText | Text, bottom?: MetricIndicatorInline)",
    "description": "One overview card: a heading slot at the top (IconText, ImageText or Text) and an optional MetricIndicatorInline at the bottom."
  },
  {
    "name": "OverviewCardBlock",
    "signature": "OverviewCardBlock(items: OverviewCardItem[], layout?: \"grid\" | \"carousel\", responsive?: boolean, action?: ActionExpression, gap?: number | string)",
    "description": "A grid or horizontal carousel of compact overview cards, each with a heading (icon/image/text) on top and an inline metric below; optionally clickable with a shared action."
  },
  {
    "name": "ContextCardItem",
    "signature": "ContextCardItem(id?: string, title: string | Tag, body?: string, bgColor?: \"gray\", bgImageSrc?: string, bgImageAlt?: string)",
    "description": "A single card inside a ContextCardBlock: a title (plain string or Tag), an optional markdown body, and an optional gray tint or background image."
  },
  {
    "name": "ContextCardBlock",
    "signature": "ContextCardBlock(items: ContextCardItem[], layout?: \"grid\" | \"carousel\", responsive?: boolean, action?: ActionExpression, gap?: number | string)",
    "description": "A grid or carousel of compact tinted context cards (title or tag plus a short bold body); an optional action makes every card clickable."
  },
  {
    "name": "CompositeCardItem",
    "signature": "CompositeCardItem(id?: string, header?: IconText | ImageText | ImageTextLarge | Text | Image, body?: (Text | BoldText | MetricIndicatorInline | IconText | Image | AreaChart | BarChart | LineChart | ListBlock | TagBlock | EntityList)[], footer?: {price?: BoldText | MetricIndicatorWithStrikethrough, button?: Button})",
    "description": "A single card inside a CompositeCardBlock: an optional header (icon/image/text), a stack of body elements (text, metrics, charts, lists, tags), and an optional price/button footer."
  },
  {
    "name": "CompositeCardBlock",
    "signature": "CompositeCardBlock(items: CompositeCardItem[], layout?: \"grid\" | \"carousel\", responsive?: boolean, action?: ActionExpression, gap?: number | string)",
    "description": "A two-per-row grid or carousel of rich cards, each with an optional header, stacked body content (text, metrics, charts, lists, tags) and a price/button footer; an optional action makes every card clickable."
  },
  {
    "name": "VisualCardItem",
    "signature": "VisualCardItem(body: BoldText, id?: string, bgImageSrc?: string, tag?: Tag, bgImageAlt?: string)",
    "description": "A single photo-first card inside a VisualCardBlock: a BoldText body panel, an optional Tag, and a background image (bgImageSrc must be a real URL; bgImageAlt is its alt text)."
  },
  {
    "name": "VisualCardBlock",
    "signature": "VisualCardBlock(items: VisualCardItem[], layout?: \"grid\" | \"carousel\", responsive?: boolean, action?: ActionExpression, gap?: number | string)",
    "description": "A grid or carousel of photo-first cards: a full-bleed background image with a tag on top and a bold text panel at the bottom; an optional action makes every card clickable."
  },
  {
    "name": "Modal",
    "signature": "Modal(title: string, open?: $binding<boolean>, children: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Form | Buttons | IconButton | Steps | InlineHeader | EntityList | EditableTable | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[], size?: \"sm\" | \"md\" | \"lg\")",
    "description": "Modal dialog. open is a reactive $boolean binding — set to true to open, X/Escape/backdrop auto-closes. Put Form with buttons inside children."
  },
  {
    "name": "Chart",
    "signature": "Chart(type: \"bar\" | \"line\" | \"area\" | \"pie\" | \"donut\" | \"scatter\", data: Record<string, string | number>[], x?: string, series?: string[], format?: \"number\" | \"currency\" | \"percent\", currency?: string, stacked?: boolean, height?: number)",
    "description": "Rows of data; x is the category key (a number key for scatter), series the value keys (default: every number key). percent values are like 45; currency is a code like \"EUR\"."
  },
  {
    "name": "Map",
    "signature": "Map(center?: string, zoom?: number, markers?: {position: string, label?: string}[], paths?: {points: string[], color?: string, weight?: number}[], height?: number)",
    "description": "Geographic map (AMap) for locations and routes: center is \"lng,lat\" (GCJ-02), zoom 3-18; markers are {position: \"lng,lat\", label?}; paths are {points: [\"lng,lat\", ...], color?, weight?}. Keep 12 markers or fewer and 3 paths or fewer so the map stays readable on phones."
  },
  {
    "name": "Svg",
    "signature": "Svg(children: Node[], viewBox: string, width?: Length, height?: Length)",
    "description": "A drawing for steps, parts, mechanisms, diagrams and layouts. Scales to its width; its shapes take expressions, so state can move them."
  },
  {
    "name": "Circle",
    "signature": "Circle(cx: number, cy: number, r: number, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)",
    "description": ""
  },
  {
    "name": "Ellipse",
    "signature": "Ellipse(cx: number, cy: number, rx: number, ry: number, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)",
    "description": ""
  },
  {
    "name": "Rect",
    "signature": "Rect(x: number, y: number, width: number, height: number, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number, rx?: number)",
    "description": ""
  },
  {
    "name": "Line",
    "signature": "Line(x1: number, y1: number, x2: number, y2: number, stroke?: Color, strokeWidth?: number, opacity?: number)",
    "description": ""
  },
  {
    "name": "Path",
    "signature": "Path(d: string, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)",
    "description": ""
  },
  {
    "name": "Polyline",
    "signature": "Polyline(points: string, stroke?: Color, strokeWidth?: number, fill?: Color, opacity?: number)",
    "description": "points like \"0,0 10,5 20,0\"."
  },
  {
    "name": "Polygon",
    "signature": "Polygon(points: string, fill?: Color, stroke?: Color, strokeWidth?: number, opacity?: number)",
    "description": ""
  },
  {
    "name": "G",
    "signature": "G(children: Node[], transform?: string, opacity?: number)",
    "description": "Group; transform like \"rotate(30 50 50)\" or \"translate(10 0)\"."
  },
  {
    "name": "SvgText",
    "signature": "SvgText(text: string, x: number, y: number, size?: number, fill?: Color, anchor?: \"start\" | \"middle\" | \"end\", weight?: \"normal\" | \"medium\" | \"semibold\")",
    "description": ""
  },
  {
    "name": "HtmlView",
    "signature": "HtmlView(html: string, height?: number, title?: string)",
    "description": "Sandboxed HTML page with inline JS, for games and canvas. No network except script CDNs. Fits its content unless height is set."
  }
]

export const OPENUI_FUNCTION_CATALOG: readonly OpenUiCatalogEntry[] = [
  {
    "name": "Append",
    "signature": "Append(list: any[], item: any) → any[]",
    "description": "Copy of the list with item added at the end"
  },
  {
    "name": "Prepend",
    "signature": "Prepend(list: any[], item: any) → any[]",
    "description": "Copy of the list with item added at the start"
  },
  {
    "name": "Concat",
    "signature": "Concat(list: any[], more: any[]) → any[]",
    "description": "Joins two lists"
  },
  {
    "name": "Remove",
    "signature": "Remove(list: any[], field: string, value: any) → any[]",
    "description": "Copy without the items whose field equals value; field \"\" compares the items themselves"
  },
  {
    "name": "RemoveAt",
    "signature": "RemoveAt(list: any[], index: number) → any[]",
    "description": "Copy without the item at index (0-based; negative counts from the end)"
  },
  {
    "name": "Update",
    "signature": "Update(list: any[], field: string, value: any, setField: string, setValue: any) → any[]",
    "description": "Copy where items whose field equals value get setField set to setValue"
  },
  {
    "name": "Toggle",
    "signature": "Toggle(list: any[], item: any) → any[]",
    "description": "Adds item if missing, removes it if present (a set of strings or numbers)"
  },
  {
    "name": "Includes",
    "signature": "Includes(list: any[] | string, item: any) → boolean",
    "description": "True if the list has item, or the text contains it"
  },
  {
    "name": "Find",
    "signature": "Find(list: any[], field: string, value: any) → any",
    "description": "First item whose field equals value, or null"
  },
  {
    "name": "IndexOf",
    "signature": "IndexOf(list: any[], item: any) → number",
    "description": "Index of item in the list, or -1"
  },
  {
    "name": "Take",
    "signature": "Take(list: any[], n: number) → any[]",
    "description": "The first n items; a negative n takes the last n"
  },
  {
    "name": "SliceList",
    "signature": "SliceList(list: any[] | string, start: number, end?: number) → any[] | string",
    "description": "Items, or characters of text, from start up to end (not included); negative counts from the end"
  },
  {
    "name": "Unique",
    "signature": "Unique(list: any[]) → any[]",
    "description": "Distinct items in first-seen order"
  },
  {
    "name": "Reverse",
    "signature": "Reverse(list: any[]) → any[]",
    "description": "Copy in reverse order"
  },
  {
    "name": "Range",
    "signature": "Range(start: number, end: number, step?: number) → number[]",
    "description": "Numbers from start up to end (not included) by step (default 1), e.g. @Range(0, 3) is [0, 1, 2]"
  },
  {
    "name": "Pick",
    "signature": "Pick(list: any[]) → any",
    "description": "A random item, or null for an empty list; draws anew each time, so call it inside @Set"
  },
  {
    "name": "Shuffle",
    "signature": "Shuffle(list: any[]) → any[]",
    "description": "Copy in random order; call it inside @Set"
  },
  {
    "name": "Flatten",
    "signature": "Flatten(list: any[]) → any[]",
    "description": "One list from a list of lists, e.g. [[1, 2], [3]] is [1, 2, 3]"
  },
  {
    "name": "Chunk",
    "signature": "Chunk(list: any[], size: number) → any[][]",
    "description": "The list cut into lists of size items, e.g. for weeks of 7 days or pages"
  },
  {
    "name": "Pow",
    "signature": "Pow(base: number, exponent: number) → number",
    "description": "base raised to exponent"
  },
  {
    "name": "Sqrt",
    "signature": "Sqrt(number: number) → number",
    "description": "Square root; null for a negative number"
  },
  {
    "name": "Random",
    "signature": "Random(min: number, max: number, integer?: boolean) → number",
    "description": "Random number from min to max (integer true: a whole number, max included); draws anew each time, so call it inside @Set"
  },
  {
    "name": "Clamp",
    "signature": "Clamp(number: number, min: number, max: number) → number",
    "description": "number kept between min and max"
  },
  {
    "name": "Percent",
    "signature": "Percent(part: number, total: number) → number",
    "description": "part / total * 100, e.g. @Percent(3, 4) is 75; 0 when total is 0"
  },
  {
    "name": "Lerp",
    "signature": "Lerp(a: number, b: number, t: number) → number",
    "description": "The value a fraction t of the way from a to b"
  },
  {
    "name": "Allocate",
    "signature": "Allocate(total: number, weights: number[], decimals?: number) → number[]",
    "description": "Splits total in proportion to weights, rounded to decimals (default 2), so the parts add up to exactly total, e.g. @Allocate(100, [1, 1, 1]) is [33.34, 33.33, 33.33]"
  },
  {
    "name": "Payment",
    "signature": "Payment(principal: number, rate: number, periods: number) → number",
    "description": "Payment per period that repays principal over periods at rate percent per period, e.g. a 30-year loan at 6% a year: @Payment(300000, 6 / 12, 360)"
  },
  {
    "name": "Convert",
    "signature": "Convert(value: number, from: string, to: string) → number",
    "description": "value from one unit to another: mm cm m km in ft yd mi; mg g kg oz lb st; ml l tsp tbsp floz cup pt qt gal (US); m/s km/h mph kn; m2 km2 ft2 ha acre; c f k"
  },
  {
    "name": "Format",
    "signature": "Format(value: number, kind?: \"number\" | \"currency\" | \"percent\" | \"compact\", decimals?: number, currency?: string) → string",
    "description": "Number as text: \"number\" 12,345.6, \"currency\" $12,345.68 (currency is a code like \"EUR\"), \"percent\" 45 -> 45%, \"compact\" 1.2M ($1.2M with a currency)"
  },
  {
    "name": "Join",
    "signature": "Join(list: any[], sep?: string, field?: string) → string",
    "description": "Joins the items (or their field) into text with sep (default \", \"), skipping nulls"
  },
  {
    "name": "Plural",
    "signature": "Plural(n: number, word: string, plural?: string) → string",
    "description": "Count and word: @Plural(1, \"guest\") is \"1 guest\", 3 gives \"3 guests\"; plural defaults to word + \"s\""
  },
  {
    "name": "Pad",
    "signature": "Pad(value: string | number, length: number, char?: string) → string",
    "description": "Pads the start of value to length with char (default \"0\"), e.g. 7 -> \"07\""
  },
  {
    "name": "Upper",
    "signature": "Upper(text: string) → string",
    "description": "Text in upper case"
  },
  {
    "name": "Lower",
    "signature": "Lower(text: string) → string",
    "description": "Text in lower case"
  },
  {
    "name": "Trim",
    "signature": "Trim(text: string) → string",
    "description": "Text without spaces at the start and end"
  },
  {
    "name": "Capitalize",
    "signature": "Capitalize(text: string) → string",
    "description": "Each word with a capital first letter, e.g. \"new york\" is \"New York\""
  },
  {
    "name": "Split",
    "signature": "Split(text: string, sep?: string) → string[]",
    "description": "List of the parts of text between sep (default \",\"), each trimmed, empty parts dropped, e.g. @Split(\"a, b,,c\") is [\"a\", \"b\", \"c\"]"
  },
  {
    "name": "Replace",
    "signature": "Replace(text: string, find: string, replacement: string) → string",
    "description": "Text with every find replaced by replacement"
  },
  {
    "name": "Duration",
    "signature": "Duration(seconds: number, style?: \"short\" | \"clock\") → string",
    "description": "Seconds as text: \"short\" 1h 20m, 4m 05s, 45s (default); \"clock\" 1:20:00, 4:05"
  },
  {
    "name": "Default",
    "signature": "Default(value?: any, fallback: any) → any",
    "description": "value, or fallback when value is null, \"\" or not a number, e.g. an empty number input: @Default($weight, 0)"
  },
  {
    "name": "MixColor",
    "signature": "MixColor(from: string, to: string, t: number) → string",
    "description": "The hex color a fraction t of the way from one hex color to another, e.g. @MixColor(\"#ffffff\", \"#0285ff\", 0.5) for a heatmap or a tint"
  },
  {
    "name": "Now",
    "signature": "Now() → string",
    "description": "The current date and time as an ISO string"
  },
  {
    "name": "Today",
    "signature": "Today() → string",
    "description": "Today's date in the viewer's time zone, as \"YYYY-MM-DD\""
  },
  {
    "name": "FormatDate",
    "signature": "FormatDate(date: string | number, style?: \"date\" | \"short\" | \"long\" | \"weekday\" | \"month\" | \"time\" | \"datetime\" | \"iso\") → string",
    "description": "A date as text: \"date\" Oct 9, 2026 (default), \"short\" Oct 9, \"long\" Friday, October 9, 2026, \"weekday\" Fri, \"month\" Oct 2026, \"time\" 9:30 PM, \"datetime\", \"iso\" 2026-10-09. Dates are \"YYYY-MM-DD\", ISO or a timestamp"
  },
  {
    "name": "AddDays",
    "signature": "AddDays(date: string | number, days: number) → string",
    "description": "The date days later (negative: earlier), as \"YYYY-MM-DD\""
  },
  {
    "name": "AddMonths",
    "signature": "AddMonths(date: string | number, months: number) → string",
    "description": "The date months later (negative: earlier), kept within the month (Jan 31 + 1 is Feb 28), as \"YYYY-MM-DD\"; 12 months is a year"
  },
  {
    "name": "DaysBetween",
    "signature": "DaysBetween(from: string | number, to: string | number) → number",
    "description": "Calendar days from one date to another (negative if to is earlier)"
  },
  {
    "name": "MonthsBetween",
    "signature": "MonthsBetween(from: string | number, to: string | number) → number",
    "description": "Whole months from one date to another (negative if to is earlier); @Floor(@MonthsBetween(birthday, @Today()) / 12) is an age"
  },
  {
    "name": "StartOf",
    "signature": "StartOf(date: string | number, unit: \"week\" | \"month\" | \"year\") → string",
    "description": "First day of the date's \"week\" (Monday), \"month\" or \"year\", as \"YYYY-MM-DD\""
  },
  {
    "name": "GroupBy",
    "signature": "GroupBy(rows: any[], key: string, field?: string, agg?: \"sum\" | \"avg\" | \"count\" | \"min\" | \"max\") → {key: string | number, value: number}[]",
    "description": "One row per distinct key, in first-seen order; value is agg of field (default \"sum\"), or the row count without a field"
  },
  {
    "name": "Pivot",
    "signature": "Pivot(rows: any[], rowKey: string, colKey: string, field?: string, agg?: \"sum\" | \"avg\" | \"count\" | \"min\" | \"max\") → Record<string, string | number>[]",
    "description": "One row per rowKey value with a column per colKey value holding agg of field, for stacked or grouped charts"
  },
  {
    "name": "Top",
    "signature": "Top(rows: any[], field: string, n: number, direction?: \"desc\" | \"asc\") → any[]",
    "description": "The n rows with the largest field (\"asc\": the smallest)"
  },
  {
    "name": "Between",
    "signature": "Between(rows: any[], field: string, min?: any, max?: any) → any[]",
    "description": "Rows whose field is from min to max, both included; compares numbers, or text such as \"YYYY-MM-DD\" dates. Leave min or max null for an open end"
  },
  {
    "name": "Bucket",
    "signature": "Bucket(rows: any[], dateField: string, unit: \"day\" | \"week\" | \"month\", field?: string, agg?: \"sum\" | \"avg\" | \"count\" | \"min\" | \"max\") → {key: string | number, value: number}[]",
    "description": "Rows per day, week (from Monday) or month of dateField, in date order, empty periods 0 for sum and count; key is \"YYYY-MM-DD\", or \"YYYY-MM\" for months"
  },
  {
    "name": "Cumulative",
    "signature": "Cumulative(rows: any[], field: string) → any[]",
    "description": "Copy of the rows with field replaced by its running total (field \"\" for a list of numbers)"
  },
  {
    "name": "MovingAvg",
    "signature": "MovingAvg(rows: any[], field: string, window: number) → any[]",
    "description": "Copy of the rows with field replaced by the average of its last window values (field \"\" for a list of numbers)"
  },
  {
    "name": "Change",
    "signature": "Change(current: number, previous: number) → number",
    "description": "Percent change from previous to current, e.g. @Change(120, 100) is 20; null when previous is 0"
  },
  {
    "name": "Histogram",
    "signature": "Histogram(values: number[], bins: number, min?: number, max?: number) → {key: string, value: number, start: number, end: number}[]",
    "description": "Counts numbers into equal-width bins (value is the count); min and max fix the range, default the data's"
  },
  {
    "name": "Stats",
    "signature": "Stats(values: number[]) → {count: number, min: number, max: number, mean: number, median: number, stdev: number}",
    "description": "Summary of numbers, all zeros for an empty list"
  }
]
