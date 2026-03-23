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

import type { ActiveWord } from './findActiveWord'

/**
 * 将建议应用到文本中
 * @param text 原始文本
 * @param suggestion 要应用的建议文本
 * @param activeWord 活跃单词信息
 * @returns 应用建议后的新文本
 */
export function applySuggestion(
    text: string,
    suggestion: string,
    activeWord: ActiveWord | null
): string {
    if (!activeWord) {
        // 如果没有活跃单词，直接追加
        return text + suggestion
    }

    // 替换活跃单词为建议
    const before = text.slice(0, activeWord.start)
    const after = text.slice(activeWord.end)

    return before + suggestion + after
}
