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
 * Sender 的 DOM disabled 闸（ChatComposer 组装逻辑单源）。
 *
 * **只承载覆盖层形态**（输入区被遮罩盖住、输入无意义）：会话失活 cover、本地模式 cover。
 *
 * 会话活动的**瞬态闸一律不进 DOM disabled**——发送 pending、权限审批（hasPendingPermission）、
 * rewind / 压缩 / 清空这些是「提交闸」语义，已由 canSend 全量门控 + 提交钮状态机（resolveSubmitButtonState）
 * 承担。挂到 DOM disabled 上会在布尔翻转的瞬间把**聚焦中的 textarea 强制失焦**（浏览器对
 * disabled 表单元素即时 blur），而 Android 虚拟键盘不跟随收起——留下「键盘在、无光标、
 * 无法输入」的僵局（2026-11-10 用户真机报告：焦点发送/审批/rewind 每次翻转都在制造这个窗口，
 * 且触屏从不自动恢复焦点——发送后恢复逻辑对 !hasFinePointer 刻意跳过）。
 *
 * 未来若要给 Sender 加禁用路，先过本文件的 doc：它属于覆盖层（可见性）还是提交门控？
 * 提交门控走 canSend，不动这里。
 *
 * 本函数只管 **textarea 闸**。参数条按钮（AttachPanel/ToolStrip 各控件）不持有焦点、
 * 无失焦风险，允许挂瞬态布尔（ChatComposer 的 chromeDisabled 层）——两级语义勿混。
 */
export interface SenderDisabledInput {
    /** 覆盖层：会话失活（未激活且不允许发送）——in-place 遮罩盖住输入区 */
    inactiveCover: boolean
    /** 覆盖层：本地模式（mode === 'local'）——遮罩盖住输入区 */
    localModeCover: boolean
}

export function resolveSenderDisabled(input: SenderDisabledInput): boolean {
    return input.inactiveCover || input.localModeCover
}
