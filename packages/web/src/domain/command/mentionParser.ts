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

/** 拼接 @ 引用路径（保留用户输入的相对形式） */
export function buildMentionPath(mentionInput: string, selectedName: string): string {
    const lastSlash = mentionInput.lastIndexOf('/')
    const dirPart = lastSlash !== -1 ? mentionInput.slice(0, lastSlash + 1) : ''
    return dirPart + selectedName
}

/**
 * 在完整文本中找到包含光标位置的 @mention 模式
 * 从光标位置向前查找最近的 @，验证其是否为独立词
 */
export function detectMentionAtCursor(
    fullText: string,
    cursorPos: number,
): { atIndex: number; afterAt: string } | null {
    // 从光标位置向前查找 @
    let searchFrom = cursorPos
    while (searchFrom > 0) {
        const atPos = fullText.lastIndexOf('@', searchFrom - 1)
        if (atPos === -1) return null

        // @ 前必须是行首或空白
        if (atPos > 0 && !/\s/.test(fullText[atPos - 1])) {
            searchFrom = atPos
            continue
        }

        // 提取 @ 后的内容，直到空白或行尾
        const afterAt = fullText.slice(atPos + 1, cursorPos)
        if (/^[a-zA-Z0-9.\/_\-~]*$/.test(afterAt)) {
            return { atIndex: atPos, afterAt }
        }

        searchFrom = atPos
    }
    return null
}
