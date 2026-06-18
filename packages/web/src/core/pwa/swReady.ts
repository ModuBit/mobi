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

/** ready 超时时长(ms):首装 SW 激活 + skipWaiting 可能到 5-8s,10s 给足余量又不至于让用户觉得卡死 */
export const SW_READY_TIMEOUT_MS = 10_000

/** navigator.serviceWorker.ready 超时(controller 孤儿时 ready 永不 resolve 也不 reject) */
export class ServiceWorkerReadyTimeout extends Error {
    constructor() {
        super('serviceWorker.ready timeout')
        this.name = 'ServiceWorkerReadyTimeout'
    }
}

/**
 * 等 SW 就绪,超时则 reject ServiceWorkerReadyTimeout(避免 controller 孤儿时永久 pending)。
 *
 * 独立模块:供 useNotificationSetup(enable/订阅)与 NotificationSettings(sendTest)共用,
 * 也便于测试隔离(测试可单独 mock 本模块,不必 partial mock useNotificationSetup)。
 *
 * @param timeoutMs 超时(测试可传小值;生产用 SW_READY_TIMEOUT_MS)
 */
export function awaitServiceWorkerReady(
    timeoutMs: number = SW_READY_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration> {
    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise<ServiceWorkerRegistration>((_, reject) =>
            setTimeout(() => reject(new ServiceWorkerReadyTimeout()), timeoutMs),
        ),
    ])
}
