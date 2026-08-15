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
 * supervisor 启动时的孤儿清理。
 *
 * 场景：上一次 supervisor 崩溃/被杀后 hub/runner 尚未走完 PPID 看门狗的
 * 退出流程（最长 5s 窗口），或 B 路径下 launchd/systemd 在 supervisor 异常
 * 退出后立即拉起新 supervisor。此时残留进程占着端口/锁文件，必须先清再拉。
 */

import { readHubState, readRunnerState } from '@/persistence'
import { isProcessAlive, killProcess } from '@/utils/process'
import { logger } from '@/ui/logger'

export async function cleanupOrphans(): Promise<void> {
    const hubState = await readHubState()
    if (hubState && isProcessAlive(hubState.pid)) {
        logger.debug(`[SUPERVISOR] Cleaning up orphan hub (PID ${hubState.pid})`)
        await killProcess(hubState.pid)
    }

    const runnerState = await readRunnerState()
    if (runnerState && isProcessAlive(runnerState.pid)) {
        logger.debug(`[SUPERVISOR] Cleaning up orphan runner (PID ${runnerState.pid})`)
        await killProcess(runnerState.pid)
    }
}
