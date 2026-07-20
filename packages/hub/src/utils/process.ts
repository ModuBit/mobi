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
 * 进程存活检测（hub 侧薄封装）。
 *
 * cli 包有完整版（killProcess / killProcessTree 等），但依赖方向上 hub 不依赖 cli，
 * hub 仅需 isProcessAlive（用于启动检测上次实例是否还活着），故独立维护此最小实现。
 */

export function isProcessAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) {
        return false
    }
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}
