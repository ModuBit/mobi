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
 * 会话子进程退出事实（metadata.lifecycleState）的判定。
 *
 * 新写入值为 `exited`；2026-11 之前的存量行写的是旧内部枚举 `archived`。
 * 两者含义相同（进程已退出），读路径一律经本函数，避免各调用点各写一份兼容判断。
 * 注意与用户可见的会话状态（sessions.status 的 `archived`）无关。
 */
export function isExitedLifecycleState(value: unknown): boolean {
    return value === 'exited' || value === 'archived'
}
