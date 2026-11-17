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

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

/**
 * 守护进程不应依赖启动时的 cwd：supervisor 继承启动 shell 的 cwd，而它可能是个
 * 事后被删的临时目录（实测 2026-11-17：从 /tmp/mobi-deploy 构建目录启动 service，
 * 部署收尾删除该目录后，simple-git 按 process.cwd() 工作直接报
 * 「Cannot use simple-git on a directory that does not exist」——skills 拉清单/
 * 安装全挂）。cwd 已失效则切到 home；有效时保持不动（相对路径语义不变）。
 */
export function ensureUsableCwd(): void {
    let cwd: string | undefined
    try {
        cwd = process.cwd()
    } catch {
        // cwd 已被删除时部分运行时的 process.cwd() 直接抛 uv_cwd 错误
    }
    if (cwd && existsSync(cwd)) return
    try {
        process.chdir(homedir())
    } catch {
        // home 都不可用属于环境级异常，交给后续启动流程自然报错
    }
}
