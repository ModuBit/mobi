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

import { Box } from 'lucide-react'

/**
 * slash 命令徽章 —— 消息渲染（Markdown 的 `slash-command` 自定义标签）与
 * composer 的 slashCommand 原子节点共用此组件，视觉只存在一份：
 * 消息侧与输入框里看到的徽章天然同步。业务呈现件（命令语义）故落 ui/shared。
 *
 * 样式单源在 styles/markdown.css 的 `.slash-command-badge`（全局类，不挂 .x-markdown
 * 作用域——composer 不在 markdown 容器里）。
 */
export function SlashCommandTag({ command }: { command: string }) {
    return (
        // icon 用 verticalAlign 负值微调、badge 走 inline（非 inline-flex）：inline-flex 的
        // 基线取首个 flex item，SVG 无文本基线 → 以 icon 底边作 badge 基线，文字整体偏离
        // 与后文不齐。
        <span className="slash-command-badge">
            <Box size={12} strokeWidth={2.4} style={{ verticalAlign: -2, marginRight: 3 }} aria-hidden="true" />
            {command}
        </span>
    )
}
