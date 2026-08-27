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

import type { UserContentBlock } from '@mobi/shared'

/** 【过渡】取 blocks 的首个非空 text 文本；blocks 化改造完成后由 summarizeBlocks 取代 */
export function getUserPlainText(blocks: UserContentBlock[]): string {
    for (const b of blocks) {
        if (b.type === 'text' && b.text.trim()) return b.text
    }
    return ''
}
