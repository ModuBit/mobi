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

import { memo } from 'react'
import { ActionLink } from '@/ui/shared/ActionLink'
import type { ToolRowChip } from '@/core/lib/toolRow'

/**
 * 工具行文件 Chip（词汇见 packages/web/CONTEXT.md）：
 * mono 字体路径/命令徽标。带 uri 时渲染为可点击链接（hover 描边暗示），
 * 点击分发 file/open（休眠会话不设守卫：文件 RPC 已 machine 化，冷会话照常可开）；
 * 无 uri 为同款形态纯展示，不误导可点。
 *
 * 点击 stopPropagation：工具行本体的点击语义是展开详情，chip 的点击语义止于打开文件，
 * 两个目标物理分离（mockup 变体 A 定案）。
 *
 * 纯展示 chip（无 uri，会话中最常见——Bash/Grep/Glob）走零 hook 快路径，
 * 消息列表几十个 chip 不各养一份 hook 订阅。
 */
export const FileChip = memo(function FileChip({ chip }: { chip: ToolRowChip }) {
    if (!chip.uri) return <span className="tool-chip">{chip.text}</span>
    return <FileChipLink chip={chip} />
})

/**
 * 可点击变体：复用 ActionLink 的完整执行链（URI 解析分发 / preventDefault+stopPropagation /
 * Enter 键盘语义 / file/open 前置 FileTypeBadge——徽章判定单源在 ActionLink，一处接入双端生效），
 * 本组件只负责 chip 形态 class。
 *
 * 路径切成「目录 + 文件名」两段：目录段可收缩、从左侧省略（样式见 base.css .tool-chip-dir），
 * 文件名不参与收缩——Write/Edit/Read 的长路径被右截断时，最能标识身份的文件名恰好先没
 * （`…/features/chat/…`），切分后无论多窄都保住文件名。
 */
const FileChipLink = memo(function FileChipLink({ chip }: { chip: ToolRowChip }) {
    const { dir, name } = splitDisplayPath(chip.text)
    return (
        <ActionLink uri={chip.uri!} className="tool-chip tool-chip-link tool-chip-path">
            {dir && <span className="tool-chip-dir">{dir}</span>}
            <span className="tool-chip-name">{name}</span>
        </ActionLink>
    )
})

/** 路径切分：最后一个 / 或 \ 归目录段（含分隔符），其余为文件名；无分隔符整体视作文件名。
 *  反斜杠必须支持：Windows 宿主的 file_path 原样透传（与項目 path 工具的归一化口径一致）。 */
function splitDisplayPath(text: string): { dir: string; name: string } {
    const idx = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
    return idx < 0 ? { dir: '', name: text } : { dir: text.slice(0, idx + 1), name: text.slice(idx + 1) }
}
