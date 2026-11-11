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
 * contenteditable 产物归一：行尾空格经浏览器落 DOM 时会被写成 NBSP，
 * ProseMirror 解析后模型里同样是 NBSP。纯文本语义应与 textarea 一致（普通空格），
 * 否则消费方的 `text.startsWith('! ')` 一类判定会在「行尾空格」时失效——
 * 所有对外读数（getText / onUpdate.text / wire 正文）统一经此归一。
 *
 * 独立成模块：ChatInput 与 chatInputQuoteDoc 都消费，放在 ChatInput.tsx 内会成环。
 */
export function normalizeEditorText(text: string): string {
    return text.includes('\u00a0') ? text.replace(/\u00a0/g, ' ') : text
}
