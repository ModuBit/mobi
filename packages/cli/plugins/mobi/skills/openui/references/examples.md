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

# Copyable Examples

Example 1 — Table (column-oriented):

root = Stack([title, tbl])
title = TextContent("Top Languages", "large-heavy")
tbl = Table([Col("Language", langs), Col("Users (M)", users), Col("Year", years)])
langs = ["Python", "JavaScript", "Java", "TypeScript", "Go"]
users = [15.7, 14.2, 12.1, 8.5, 5.2]
years = [1991, 1995, 1995, 2012, 2009]

Example 2 — Bar chart:

root = Stack([title, chart])
title = TextContent("Q4 Revenue", "large-heavy")
chart = BarChart(labels, [s1, s2], "grouped")
labels = ["Oct", "Nov", "Dec"]
s1 = Series("Product A", [120, 150, 180])
s2 = Series("Product B", [90, 110, 140])

Example 3 — Form with validation:

root = Stack([title, form])
title = TextContent("Contact Us", "large-heavy")
form = Form("contact", btns, [nameField, emailField, countryField, msgField])
nameField = FormControl("Name", Input("name", "Your name", "text", { required: true, minLength: 2 }))
emailField = FormControl("Email", Input("email", "you@example.com", "email", { required: true, email: true }))
countryField = FormControl("Country", Select("country", countryOpts, "Select...", { required: true }))
msgField = FormControl("Message", TextArea("message", "Tell us more...", 4, { required: true, minLength: 10 }))
countryOpts = [SelectItem("us", "United States"), SelectItem("uk", "United Kingdom"), SelectItem("de", "Germany")]
btns = Buttons([Button("Submit", @ToAssistant("Submit"), "primary"), Button("Cancel", @ToAssistant("Cancel"), "secondary")])

Example 4 — Tabs with mixed content:

root = Stack([title, tabs])
title = TextContent("React vs Vue", "large-heavy")
tabs = Tabs([tabReact, tabVue])
tabReact = TabItem("react", "React", reactContent)
tabVue = TabItem("vue", "Vue", vueContent)
reactContent = [TextContent("React is a library by Meta for building UIs."), Callout("info", "Note", "React uses JSX syntax.")]
vueContent = [TextContent("Vue is a progressive framework by Evan You."), Callout("success", "Tip", "Vue has a gentle learning curve.")]

Example 5 — KPI and product cards:

root = Stack([kpiHeader, kpiBlock, productsHeader, productCards])
kpiHeader = InlineHeader("This Month", "Key account metrics")
kpiBlock = SnippetCardBlock([kpi1, kpi2, kpi3])
kpi1 = SnippetCardItem("revenue", kpi1lhs, kpi1rhs)
kpi1lhs = IconText(kpi1icon, "neutral", "m", "Revenue", "Month to date", false, "horizontal")
kpi1icon = Icon("circle-dollar-sign", "finance")
kpi1rhs = BoldText("number", "$48,200", "+8.1%", "metric")
kpi2 = SnippetCardItem("active-users", kpi2lhs, kpi2rhs)
kpi2lhs = IconText(kpi2icon, "neutral", "m", "Active Users", "This month", false, "horizontal")
kpi2icon = Icon("users", "people")
kpi2rhs = BoldText("number", "1,204", "+3.4%", "metric")
kpi3 = SnippetCardItem("churn", kpi3lhs, kpi3rhs)
kpi3lhs = IconText(kpi3icon, "neutral", "m", "Churn", "This month", false, "horizontal")
kpi3icon = Icon("user-minus", "people")
kpi3rhs = BoldText("number", "1.8%", "-0.3%", "metric")
productsHeader = InlineHeader("Top Products", "By units sold")
productCards = CompositeCardBlock([p1, p2])
p1 = CompositeCardItem("widget-pro", p1header, [p1body], p1footer)
p1header = IconText(p1icon, "neutral", "m", "Widget Pro", "Best seller", true, "horizontal")
p1icon = Icon("package", "shopping")
p1body = MetricIndicatorInline("2,410 units", "Sold this month", { direction: "up", value: 12 })
p1footer = { price: BoldText("text", "$29.00"), button: p1btn }
p1btn = Button("View Details", @ToAssistant("Show details for Widget Pro"), "secondary")
p2 = CompositeCardItem("widget-mini", p2header, [p2body], p2footer)
p2header = IconText(p2icon, "neutral", "m", "Widget Mini", "New arrival", true, "horizontal")
p2icon = Icon("box", "shopping")
p2body = MetricIndicatorInline("980 units", "Sold this month", { direction: "up", value: 4 })
p2footer = { price: BoldText("text", "$14.00"), button: p2btn }
p2btn = Button("View Details", @ToAssistant("Show details for Widget Mini"), "secondary")

Example 6 — Editable table and a selection form:

root = Stack([tableHeader, editTable, formHeader, prefsForm])
tableHeader = InlineHeader("Team Roster", "Click a cell to edit")
editTable = EditableTable("roster", [colName, colRole, colStart], [row1, row2])
colName = { type: "text", key: "name", header: "Name" }
colRole = { type: "select", key: "role", header: "Role", options: [roleEng, roleDesign] }
roleEng = { value: "eng", label: "Engineering" }
roleDesign = { value: "design", label: "Design" }
colStart = { type: "date-single", key: "start", header: "Start Date" }
row1 = { id: "1", values: ["Alex Kim", "eng", "2024-01-15"] }
row2 = { id: "2", values: ["Jamie Lee", "design", "2024-03-02"] }
formHeader = InlineHeader("Preferences", "Tell us how you like to work")
prefsForm = Form("prefs", formButtons, [fc1, fc2])
fc1 = FormControl("Working Style", styleCards, "Pick the one that fits best")
styleCards = OptionCards("style", "single", [style1, style2])
style1 = OptionCard("focused", "Deep Focus", "Long uninterrupted blocks", style1icon)
style1icon = Icon("target", "tools")
style2 = OptionCard("collab", "Collaborative", "Frequent pairing and syncs", style2icon)
style2icon = Icon("users", "people")
fc2 = FormControl("Tools", toolChips, "Select all that apply")
toolChips = Chips("tools", "multiple", [tool1, tool2, tool3])
tool1 = ChipItem("figma", "Figma", tool1icon)
tool1icon = Icon("figma", "design")
tool2 = ChipItem("slack", "Slack", tool2icon)
tool2icon = Icon("message-square", "communication")
tool3 = ChipItem("notion", "Notion", tool3icon)
tool3icon = Icon("notebook", "text")
formButtons = Buttons([Button("Save", @ToAssistant("Save preferences"), "primary")])

## Custom component examples

Custom component example (argument order matters): `root = Stack([chart, flow])` / `chart = Chart("bar", rows, "k", ["v"])` / `rows = [{"k": "Q1", "v": 420}]` / `flow = Svg([box, arrow, caption], "0 0 240 120")` / `box = Rect(10, 10, 80, 40, "surface", "ink", 2)` / `arrow = Line(90, 30, 130, 30, "muted", 2)` / `caption = SvgText("Step 1", 20, 80, 12, "muted")` — Svg takes the shapes list first, then viewBox (width/height optional); SvgText takes the text first, then x and y; Chart series are column names, not Series(...) objects.

Composed page example (itinerary — one block, no markdown duplication): `root = Stack([title, sub, map, stops, tip])` / `title = TextContent("San Francisco in a Day", "large-heavy")` / `sub = TextContent("Three stops, all walkable", "small")` / `map = Map("122.4194,37.7749", 12, [{"position": "122.4194,37.7749", "label": "1"}, {"position": "122.4098,37.8087", "label": "2"}, {"position": "122.4187,37.8029", "label": "3"}], [{"points": ["122.4194,37.7749", "122.4098,37.8087", "122.4187,37.8029"], "color": "#ff6600", "weight": 4}])` / `stops = Stack([stop1, stop2, stop3])` / `stop1 = Card([TextContent("**9:00 · Ferry Building**"), TextContent("Market hall breakfast and bay views.")], "card")` / `stop2 = Card([TextContent("**11:30 · Fisherman's Wharf**"), TextContent("Sea lions and clam chowder.")], "card")` / `stop3 = Card([TextContent("**15:00 · Coit Tower**"), TextContent("City panorama, then walk down to North Beach.")], "card")` / `tip = Card([Callout("info", "Getting around", "Everything is within 25 minutes on foot.")])` — markers labels 1/2/3 render as numbered pins, matching the per-stop cards; keep 12 markers or fewer (use city zoom 11-13; the component swaps in a detailed overseas tile layer automatically).
