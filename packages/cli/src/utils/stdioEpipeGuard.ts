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
 * stdio 孤儿管道防护。
 *
 * 会话 CLI 由 runner 以 detached:true + stdio pipe spawn（runner/run.ts），stdout/stderr
 * 的读端在 runner 手里（收集调试日志尾巴）。runner 死亡（服务重启/换血等）时：
 * - 进程因 detached 幸存、agent 对话走 socket 不受影响——这正是设计意图；
 * - 但 stdout/stderr 管道读端永久消失，没有任何"重连"机制会修复它们。
 *
 * 此后任何一次往 stderr 的写入都会抛出无人处理的 EPIPE 并终止整个进程。
 * 导火索不可预期且与业务无关（如 Bun 对内部 warning 的默认打印）——2026-08-27 实际发生：
 * 服务重启 19 分钟后一次 rewind 流程中的 warning 输出炸掉了存活会话。
 *
 * 防护语义：EPIPE（对端死亡）是可预期、无害的写入失败，监听后静默忽略；其余错误维持
 * 默认抛出行为不变。必须在进程最早期安装（bootstrap 入口 dynamic import 之前），
 * 晚于第一条 warning 就等于没装。
 */
export function installStdioEpipeGuard(): void {
    for (const stream of [process.stdout, process.stderr]) {
        stream?.on?.('error', (err: NodeJS.ErrnoException) => {
            if (err?.code === 'EPIPE') return
            // 非 EPIPE 维持 Node/Bun 流错误默认语义：无其他监听者时照常抛出
            throw err
        })
    }
}
