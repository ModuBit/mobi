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
 */
export const FileChip = memo(function FileChip({ chip }: { chip: ToolRowChip }) {
    const { requestDispatch, popconfirmProps } = useGuardedActionDispatch()

    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault()
        e.stopPropagation()
        void requestDispatch(chip.uri!)
    }

    const chipElement = chip.uri ? (
        <a
            href={chip.uri}
            className="tool-chip tool-chip-link"
            onClick={handleClick}
        >
            {chip.text}
        </a>
    ) : (
        <span className="tool-chip">{chip.text}</span>
    )

    if (!chip.uri) return chipElement
    return <Popconfirm {...popconfirmProps}>{chipElement}</Popconfirm>
})
