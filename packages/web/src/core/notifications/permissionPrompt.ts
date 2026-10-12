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
 * 通知权限引导 flag（src 分层治理票 01 自 NotificationPermissionGate 下沉）。
 * 纯模块级状态，归 core/notifications 后 SSEProvider 不再反向依赖 UI 组件。
 *
 * 模块级守卫：同一页面生命周期内只引导一次（刷新后重置）。
 * claim 置位放在 setTimeout 回调内（由 Gate 消费），避免 React StrictMode 双调
 * effect 时被 cleanup 清掉后不再补设。
 */

let permissionPromptShown = false

/** 重置引导 flag（换号 logout 时调用，让新用户重新获得首次引导）。SPA 内 logout→login 不刷新页面，不重置则新用户不再引导 */
export function resetPermissionPrompt() {
    permissionPromptShown = false
}

/**
 * 原子「查并置位」：未引导过则占位并返回 true（本次应引导），已引导过返回 false（跳过）。
 * 替代 Gate 内直接读写 flag——查与置位在同一步完成，不留给中间态。
 */
export function claimPermissionPrompt(): boolean {
    if (permissionPromptShown) return false
    permissionPromptShown = true
    return true
}
