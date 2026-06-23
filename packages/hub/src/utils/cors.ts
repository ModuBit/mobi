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
 * 守卫：credentials 闭环（cookie 同源自动携带）与 origin:'*' 互斥。
 *
 * CORS credentials:true 时浏览器拒绝通配 origin（Fetch 规范），导致：
 * - 跨域带 cookie 的请求（web withCredentials）被拒
 * - media/SSE/terminal 全部静默 401（cookie 不被发送或响应头被拒）
 *
 * 启动期直接 throw，迫使运维配置具体域名（CORS_ORIGINS），而非静默 warn 后线上 401。
 * credentials:false 的 socket 层不受此约束（`*` 合法）——仅 credentials:true 的 HTTP 层调用本守卫。
 *
 * @param corsOrigins 配置的 origin 列表
 * @param credentials 是否启用 credentials（cookie）
 */
export function assertCorsOriginsForCredentials(
    corsOrigins: string[],
    credentials: boolean,
): void {
    if (credentials && corsOrigins.includes('*')) {
        throw new Error(
            '[CORS] credentials:true 与 origin:"*" 互斥 —— 浏览器会拒绝跨域 cookie，' +
            '导致 web 认证 / media / SSE / terminal 全部静默 401。' +
            '请在 CORS_ORIGINS 配置具体域名（逗号分隔），不要使用 "*"。',
        )
    }
}
