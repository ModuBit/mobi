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
 * 行号相关工具函数
 */

/** 最小行号列宽度 */
const MIN_LINE_NUM_WIDTH = 40
/** 等宽字体中每个数字的宽度 */
const DIGIT_WIDTH = 8
/** 行号列左右 padding 总和 */
const LINE_NUM_PADDING = 16

/** 计算行号列宽度（根据最大行号） */
export function calculateLineNumWidth(maxLineNum: number): number {
    const digits = String(maxLineNum).length
    return Math.max(MIN_LINE_NUM_WIDTH, digits * DIGIT_WIDTH + LINE_NUM_PADDING)
}

/** 计算数组中的最大行号（避免栈溢出） */
export function getMaxLineNum(lines: Array<{ lineNum?: number } | null | undefined>): number {
    if (lines.length === 0) return 1
    const max = lines.reduce((m, l) => Math.max(m, l?.lineNum ?? 0), 0)
    return max > 0 ? max : 1
}
