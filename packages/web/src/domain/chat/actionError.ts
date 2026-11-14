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

import { isAxiosError } from 'axios'
import { extractApiError, isNetworkError } from '@/core/data/api/client'

/**
 * 动作失败（审批/提交/上传等用户触发的请求）的展示文案收口。
 *
 * 两类来源各有归宿，勿在 catch 里直译 `e.message`：
 * - 网络层失败（请求没到服务端）：axios 的 message 是英文原文 "Network Error"，
 *   直译上屏即通知卡片里的红框英文（2026-11-13 用户截图实锤），换本地化提示；
 * - 到达服务端的失败：走 extractApiError 统一提取 daemon 下发的业务 detail
 *   （裸读 message 只会拿到 "Request failed with status code N"，真实原因在 body 里）。
 *
 * 落在 domain 供 pages 与全部 features 域共用（审批 Footer / elicitation 面板 /
 * 新建会话 / 归档恢复 / 附件上传等）——i18n 经 t 参数注入，函数本身零 React。
 *
 * @param e            catch 到的异常
 * @param t            i18n 翻译函数（调用方传 useTranslation 的 t）
 * @param fallbackKey  非 Error 抛出值的兜底文案 key（各场景语义不同，如上传用
 *                     「上传失败」；缺省通用「请求失败」）
 */
export function describeActionError(
    e: unknown,
    t: (key: string) => string,
    fallbackKey: string = 'chat.tool.requestFailed'
): string {
    if (isNetworkError(e)) return t('chat.error.title.network')
    // axios 错误（带 response）或 Error 实例：extractApiError 提取业务 detail
    if (e instanceof Error || isAxiosError(e)) return extractApiError(e)
    return t(fallbackKey)
}
