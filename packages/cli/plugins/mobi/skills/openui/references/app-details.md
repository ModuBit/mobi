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

# mode="app" HTML App Details

- For mode="app" HTML apps: the host injects a `--mobi-*` CSS variable palette (and a low-specificity base style) that follows the user's light/dark theme — style your app with these variables (background: var(--mobi-bg), color: var(--mobi-fg), borders: var(--mobi-border), accent: var(--mobi-primary), radius: var(--mobi-radius), fonts var(--mobi-font-body)/var(--mobi-font-mono), plus --mobi-bg-base/--mobi-bg-elevated/--mobi-bg-layout/--mobi-fg-secondary/--mobi-fg-muted/--mobi-on-primary/--mobi-success/--mobi-warning/--mobi-danger/--mobi-border-muted) instead of hard-coded colors, so the app adapts to both themes automatically; text placed on a colored block (e.g. a primary button or chip) takes `color: var(--mobi-on-primary)` — never hardcode white/black, the accent is light-toned in dark theme; your own CSS always wins over the injected base.
- For mode="app" HTML apps: the host also injects `window.MobiApp.issueNewTurn(text)` — call it ONLY from explicit user actions (e.g. a "continue with these choices" button onclick) to send the app's current state back to the conversation; the message arrives as if the user typed it. Keep the text a concise plain-language summary of the chosen state (recommended under 200 chars), never call it automatically, and do NOT expose raw JSON dumps.
