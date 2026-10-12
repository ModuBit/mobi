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

import type { ChatBlock } from '@/domain/chat/types'

/**
 * 分页保形过滤：`hasNextPage` 时隐藏「孤儿」running 工具块，保留「活跃」running 工具块。
 *
 * 背景：会话消息按窗口加载（最新 VISIBLE_WINDOW 条，更老的翻页）。工具块
 * `state='running'` 有两种成因，必须区别对待：
 *
 *  ① 活跃工具——当前 agent turn 正在执行的工具。它位于块列表尾部（最新），
 *     其 tool_result 尚未到达（模型发完 tool_use 即停笔等结果）。这类块**必须渲染**，
 *     否则用户看不到工具执行进度（Write 这类长任务会被整段执行窗口隐藏，直到
 *     tool_result 到达才出现——即「等 result 才渲染」现象）。
 *
 *  ② 孤儿工具——tool_use 在已加载窗口内、但 tool_result 落在更老的未加载页，
 *     导致 reducer 永远拿不到结果、块永久卡 running。这类块位于块列表**中部**
 *     （其后还有更新的块），会误导用户以为有工具卡死，需过滤掉。
 *
 * 区分判据：从尾部向前扫描，跳过连续的 running 工具块得到「活跃组」起点 `activeStart`；
 * `idx >= activeStart` 的 running 工具块是活跃工具（保留），更早的 running 工具块是孤儿（过滤）。
 * 非工具块、非 running 工具块一律不受影响。
 *
 * `hasNextPage=false`（无更老历史页）时不存在孤儿，原样返回。
 */
export function filterBlocksForPagination(
    blocks: ChatBlock[],
    hasNextPage: boolean,
): ChatBlock[] {
    if (!hasNextPage) return blocks

    // 从尾部向前跳过连续的 running 工具块，定位活跃组起点
    let activeStart = blocks.length
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
        const b = blocks[i]
        if (b.kind === 'tool-call' && b.tool.state === 'running') {
            activeStart = i
            continue
        }
        break
    }

    // 活跃组覆盖全部块（尾部连续 running 直达头部）→ 无需过滤，原样返回保引用稳定
    if (activeStart === 0) return blocks

    return blocks.filter((b, idx) => {
        if (b.kind !== 'tool-call') return true
        if (b.tool.state !== 'running') return true
        // running 工具块：尾部活跃组（idx >= activeStart）保留，中部孤儿过滤
        return idx >= activeStart
    })
}
