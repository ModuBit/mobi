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
 * 触发符检测的共享逻辑
 * / 斜杠命令 与 @ 文件引用 共用同一套「从光标向前找独立词触发符」的扫描算法，
 * 仅触发符字符与「触发符到光标之间内容的合法性校验」不同，故抽出此 helper。
 */

/**
 * 从光标位置向前查找最近的、前置为行首或空白的触发符（独立词）
 *
 * @param text       完整文本
 * @param cursorPos  光标位置（0 ~ text.length）
 * @param trigger    单字符触发符（如 '/' 或 '@'）
 * @param isAfterValid 校验「触发符到光标之间内容」是否合法；返回 false 则跳过当前命中、继续向前找
 * @returns 命中时返回 { index: 触发符下标, after: 触发符到光标之间的内容 }；否则 null
 */
export function findStandaloneTriggerBeforeCursor(
    text: string,
    cursorPos: number,
    trigger: string,
    isAfterValid: (after: string) => boolean,
): { index: number; after: string } | null {
    let searchFrom = cursorPos
    while (searchFrom > 0) {
        const pos = text.lastIndexOf(trigger, searchFrom - 1)
        if (pos === -1) return null

        // 触发符前必须是行首或空白（独立词），否则跳过它继续向前找
        if (pos > 0 && !/\s/.test(text[pos - 1])) {
            searchFrom = pos
            continue
        }

        const after = text.slice(pos + 1, cursorPos)
        if (isAfterValid(after)) {
            return { index: pos, after }
        }

        searchFrom = pos
    }
    return null
}
