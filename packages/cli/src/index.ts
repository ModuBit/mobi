#!/usr/bin/env bun
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

// 必须在所有其他模块 import 之前加载 profile，
// 因为 Configuration 单例在模块加载时就会读取 process.env
import { loadProfile } from '@mobi/shared/profile'
import { installExitLogger, installExitHandlers, resolveMobiLogsDir } from '@mobi/shared/exitLogger'
import { ensureLoopbackBypassesProxy } from '@mobi/node-core/utils/proxyEnv'

// 加载 profile 并从 process.argv 中移除 --profile 参数
// （loadProfile 会 splice 传入的数组，这里直接传 argv 切片以同步移除）
const argvSlice = process.argv.slice(2)
loadProfile(argvSlice)
// 同步修改 process.argv，确保下游 getCliArgs() 不再看到 --profile
process.argv = [process.argv[0], process.argv[1], ...argvSlice]

// loopback 自访（健康门 / API 调用）永不走代理：shell 常驻 http_proxy 且无 no_proxy
// 时，loopback fetch 会被本地代理劫持回 502（restart 误报 health check failed）。
// Bun fetch / axios 惰性读取 env，此处归一化一次全进程生效；supervisor / daemon
// 均由 CLI spawn，env 随之继承
ensureLoopbackBypassesProxy()

// 退出日志：CLI 主进程挂载 crash/信号/exit 捕获。
// exitOnSignal:true —— cli 无自定义退出 handler，必须由 exitLogger 在信号后 exit，
// 否则 Ctrl+C/SIGTERM 仅记录不退出，进程卡死。
// 无启动检测兜底——CLI 命令通常短生命周期，无长驻 pid 标记可查。
const cliExitLogger = installExitLogger('cli', { logsDir: resolveMobiLogsDir() })
installExitHandlers('cli', cliExitLogger, undefined, { exitOnSignal: true })

// 动态 import，确保 profile 环境变量已注入后再加载依赖模块
import('./commands/runCli').then(({ runCli }) => {
    void runCli()
}).catch((err) => {
    console.error('Failed to start CLI:', err)
    process.exit(1)
})

// 注册编译期内嵌 claude 二进制 loader（ticket-12）：embeddedClaudeBinary.bun 绑定 cli
// 的编译期资产（bun:bundle feature + tools/archives 相对路径），归 cli 包；node-core 的
// claudeExecutable 经此注入取用。须在 profile 加载之后（configuration 单例会读注入的 env）
void (async () => {
    const { registerEmbeddedClaudeBinaryLoader } = await import('@mobi/node-core/claudeSdk/claudeExecutable')
    const { loadEmbeddedClaudeBinary } = await import('@/runtime/embeddedClaudeBinary.bun')
    registerEmbeddedClaudeBinaryLoader(loadEmbeddedClaudeBinary)
})()
