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
 * 写剪贴板（navigator.clipboard 失败时降级 execCommand——非安全上下文/旧内核）。
 * 复制按钮与移动端消息长按操作菜单等全站复制场景共用。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        // 降级 execCommand（非安全上下文/旧内核）；execCommand 本身不可用时按失败处理
        try {
            const textarea = document.createElement('textarea')
            textarea.value = text
            document.body.appendChild(textarea)
            textarea.select()
            const ok = document.execCommand('copy')
            document.body.removeChild(textarea)
            return ok
        } catch {
            return false
        }
    }
}
