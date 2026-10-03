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
 * 场景：上一次 supervisor 崩溃/被杀后 daemon 尚未走完 PPID 看门狗的
 * 退出流程（最长 5s 窗口），或 B 路径下 launchd/systemd 在 supervisor 异常
 * 退出后立即拉起新 supervisor。此时残留进程占着端口/锁文件，必须先清再拉。
 */

import { readDaemonState, readHubState, readRunnerState } from '@mobi/node-core/persistence'
import { isProcessAlive, killProcess } from '@mobi/node-core/utils/process'
import { logger } from '@mobi/node-core/logger'

export async function cleanupOrphans(): Promise<void> {
    const daemonState = await readDaemonState()
    if (daemonState && isProcessAlive(daemonState.pid)) {
        logger.debug(`[SUPERVISOR] Cleaning up orphan daemon (PID ${daemonState.pid})`)
        await killProcess(daemonState.pid)
    }

    // 过渡期兜底（ticket-22）：升级后首次重启 supervisor 时，上一版独立
    // hub/runner 进程可能还活着（写的是旧 state 文件）。等存量环境都换到
    // 单组件 daemon 后可删（含 persistence 的 readHubState/readRunnerState）
    const hubState = await readHubState()
    if (hubState && isProcessAlive(hubState.pid)) {
        logger.debug(`[SUPERVISOR] Cleaning up orphan legacy hub (PID ${hubState.pid})`)
        await killProcess(hubState.pid)
    }

    const runnerState = await readRunnerState()
    if (runnerState && isProcessAlive(runnerState.pid)) {
        logger.debug(`[SUPERVISOR] Cleaning up orphan legacy runner (PID ${runnerState.pid})`)
        await killProcess(runnerState.pid)
    }
}
