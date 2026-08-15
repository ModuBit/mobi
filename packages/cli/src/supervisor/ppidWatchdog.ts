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
 * PPID 看门狗：hub/runner 被 supervisor 托管时保证"父死子亡"。
 *
 * supervisor 被 SIGKILL 后子进程不会收到任何信号（变孤儿、被 init 收养），
 * 端口与锁文件将一直被占。本看门狗轮询父进程存活状态，发现父进程死亡后
 * 回调调用方（内部以 SIGTERM 自杀，走既有优雅清理路径）。
 */

import { isProcessAlive } from '@/utils/process'

export interface PpidWatchdogOptions {
    /** 监控的父进程 pid，默认捕获调用时的 process.ppid */
    parentPid?: number
    /** 轮询间隔，默认 5s */
    intervalMs?: number
    /** 存活检查（注入点，测试用） */
    isAlive?: (pid: number) => boolean
    /** 父进程死亡时触发（只触发一次） */
    onOrphaned: () => void
}

export function startPpidWatchdog(options: PpidWatchdogOptions): () => void {
    const parentPid = options.parentPid ?? process.ppid
    const intervalMs = options.intervalMs ?? 5_000
    const isAlive = options.isAlive ?? isProcessAlive

    let stopped = false
    const timer = setInterval(() => {
        if (stopped) return
        if (!isAlive(parentPid)) {
            stopped = true
            clearInterval(timer)
            options.onOrphaned()
        }
    }, intervalMs)
    // 看门狗不应阻止进程自然退出
    timer.unref?.()

    return () => {
        stopped = true
        clearInterval(timer)
    }
}
