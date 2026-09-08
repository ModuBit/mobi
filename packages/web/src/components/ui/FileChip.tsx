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
import type { MouseEvent } from 'react'
import { Popconfirm } from 'antd'
import { useGuardedActionDispatch } from './ActionLink'
import type { ToolRowChip } from '@/core/lib/toolRow'

/**
 * 工具行文件 Chip（词汇见 packages/web/CONTEXT.md）：
 * mono 字体路径/命令徽标。带 uri 时渲染为可点击链接（hover 描边暗示），
 * 点击走 useGuardedActionDispatch 守卫分发（未激活会话 → Popconfirm 引导恢复）；
 * 无 uri 为同款形态纯展示，不误导可点。
 *
 * 点击 stopPropagation：工具行本体的点击语义是展开详情，chip 的点击语义止于打开文件，
 * 两个目标物理分离（mockup 变体 A 定案）。
 *
 * 纯展示 chip（无 uri，会话中最常见——Bash/Grep/Glob）走零 hook 快路径：
 * 守卫链（7 个 hook + Popconfirm）只在可点击变体上挂载，消息列表几十个 chip
 * 不各养一份守卫订阅。
 */
export const FileChip = memo(function FileChip({ chip }: { chip: ToolRowChip }) {
    if (!chip.uri) return <span className="tool-chip">{chip.text}</span>
    return <FileChipLink chip={chip} />
})

/** 可点击变体：守卫分发 + Popconfirm 恢复引导（与 ActionLink 同一 hook） */
const FileChipLink = memo(function FileChipLink({ chip }: { chip: ToolRowChip }) {
    const { requestDispatch, popconfirmProps } = useGuardedActionDispatch()

    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault()
        e.stopPropagation()
        void requestDispatch(chip.uri!)
    }

    return (
        <Popconfirm {...popconfirmProps}>
            <a href={chip.uri} className="tool-chip tool-chip-link" onClick={handleClick}>
                {chip.text}
            </a>
        </Popconfirm>
    )
})
