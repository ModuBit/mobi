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
 * 轮询等待一个 HTTP URL 返回 2xx。
 * 收敛自 commands/hub.ts 与 commands/service.ts 各自重复的 waitForHubReady。
 */

export async function waitForUrlOk(
    url: string,
    timeoutMs: number = 10_000,
    pollIntervalMs: number = 200,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
            if (response.ok) return true
        } catch {
            // 尚未就绪
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }
    return false
}
