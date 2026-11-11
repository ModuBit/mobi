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
 * 键盘事件是否处于 IME 组合残留：isComposing 之外补 keyCode 229 兜底——WebKit 的
 * compositionend 先于 keydown 派发，确认候选词的 Enter/Esc 到达时 isComposing 已翻
 * false，只剩 229 可辨认（Safari/旧 Chromium 实测）。键位判定一律经此谓词，勿散写。
 */
export function isComposingEvent(e: { nativeEvent: { isComposing: boolean; keyCode?: number } }): boolean {
    return e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
}

/**
 * 单行输入的回车提交键位判定（Input / PasswordField 的 onPressEnter 与消费方共用）：
 * **Enter 提交，IME 组合中的 Enter 是确认候选词，不提交**（中文输入法必踩）。
 * 与 commentTextareaKeys.ts 同层同语言——键位语义单处承载，消费方只按返回值分发
 * 动作。Escape 取消等旁路键不在此列（消费方 onKeyDown 自理，Input 处理完 Enter 后
 * 原样透传 onKeyDown，两者共存）。
 */
export function isSubmitEnter(e: { key: string; nativeEvent: { isComposing: boolean; keyCode?: number } }): boolean {
    return e.key === 'Enter' && !isComposingEvent(e)
}
