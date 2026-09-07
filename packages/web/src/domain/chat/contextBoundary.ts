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
 * 上下文边界判据单一来源（fork / rewind 入口共用，fork-session spec §2）：
 * `msg.seq > contextBoundarySeq` = 边界之后（可操作）。
 * 语义对齐 hub `contextBoundary.ts`（CONTEXT_BOUNDARY_SEQ_KEY），两端同步义务注释同款。
 *
 * 缺失语义：
 * - 指针缺失（undefined，存量会话未回填）→ 按 0 = 保守放行（hub 读侧首次消费会回填）
 * - 行 seq 缺失（快照流式行）→ 不可判定保守放行（放行侧 hub 闸门 + CLI 预检把守）
 */
export function isAfterContextBoundary(
    seq: number | null | undefined,
    contextBoundarySeq: number | undefined,
): boolean {
    if (seq == null) return true
    return seq > (contextBoundarySeq ?? 0)
}
