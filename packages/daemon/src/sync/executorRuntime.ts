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
 * executor 运行时状态内存单例（ticket 205）：executor 状态的家。
 *
 * 运行时事实（status / pid / httpPort / lastSpawnError / shutting-down…）随进程生灭，
 * 不再落库——读方（/api/daemon/status、daemon-status SSE）只看这里；machineCache 的
 * 落库写路径暂留（R2：诊断兼容，401 store 退场时一并删除）。
 *
 * 类型沿 ExecutorState（shared/hostProtocol.ts）；602 内部命名一把梭时随全局改名换为
 * ExecutorState。单写者 = server 注入给 executor core 的 updateExecutorState，
 * 同进程内无并发写者。
 */

import type { ExecutorState } from '@mobi/shared/hostProtocol'

let executorState: ExecutorState | null = null

/** 直写：handler 收旧值返回新值（与 executor core 上报 handler 签名一致），返回新状态 */
export function updateExecutorState(handler: (state: ExecutorState | null) => ExecutorState): ExecutorState {
    executorState = handler(executorState)
    return executorState
}

/** 只读：未上报过（启动早期）为 null */
export function getExecutorState(): ExecutorState | null {
    return executorState
}
