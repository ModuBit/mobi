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

/** toast 处理动作 */
export type ToastAction = 'ignore' | 'page-toast' | 'system-notification'

/** 决策上下文 */
export interface ToastContext {
    /** 当前路由所在的 sessionId,null 表示不在 session 详情页 */
    activeSessionId: string | null
    /** 页面是否在后台(document.hidden) */
    isHidden: boolean
}

/**
 * toast 三分支决策:
 * ① visible 且 activeSessionId == 事件 session → ignore(用户正盯着)
 * ② visible 且不在该 session → page-toast
 * ③ hidden(后台)→ system-notification
 */
export function decideToastAction(eventSessionId: string, ctx: ToastContext): ToastAction {
    if (ctx.isHidden) {
        return 'system-notification'
    }
    if (ctx.activeSessionId === eventSessionId) {
        return 'ignore'
    }
    return 'page-toast'
}
