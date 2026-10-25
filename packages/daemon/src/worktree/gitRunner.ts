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
 * git 执行注入面（worktree 生命周期服务）：统一 (cwd, args) → stdout 的薄签名，
 * 测试可注入假件；失败抛错（message 含 git stderr），调用方按语义降级。
 * 实现直接复用 node-core 的 git 收口（maxBuffer / 环境变量口径单源）。
 */

import { git } from '@mobi/node-core/git/gitExec'

export type GitRunner = (cwd: string, args: string[]) => Promise<string>

/** 真实 git 执行（node-core 唯一收口） */
export const runGit: GitRunner = git

/** git/文件系统失败文案（Error.message 已含 stderr；非 Error 兜底 String） */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
