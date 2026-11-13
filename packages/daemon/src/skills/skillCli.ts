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
 * skills CLI 执行器（skill-mgmt 票 04/05）：tracked 删除 / 安装 / 更新的统一分派层。
 *
 * 语义依据（调研实锤，notes.md addCommand/removeCommand 源码）：
 * - 一律只装到 claude-code agent（--agent claude-code），不传 --copy（symlink 形态）
 * - user 级传 -g、project 级靠 cwd 定位（update 另有显式 -p）
 * - tracked 删除归 CLI 闭环：删 agent 目录条目 → isStillUsed 判定 → 中央仓真身与
 *   lock 条目同生共死；mobi 不自判真身
 * - untracked 是 mobi 自管文件：symlink 行只删链接（真身归 CLI 语义或用户自管），真目录整体删除
 * - 删除前二次校验目标确为 skill 根下以 skill 名命名的直接子项（防 TOCTOU / 路径注入误删）
 * - spawn 走 argv 数组不经 shell，source 字符串天然无注入面
 */
import { existsSync, lstatSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { SkillInfo } from '@mobi/shared'
import { daemonLogger } from '../logger'
import type { SkillScanRoots } from './skillScanner'
import { cliCwd, scopeView, type SkillScope } from './skillScope'

/** skills CLI 单次执行结果：ok = 退出码 0；output 含 stdout+stderr（失败透传前端） */
export interface SkillsCliResult {
    ok: boolean
    output: string
}

/** 可注入的 CLI 执行器（测试桩 fake 语义；生产 spawn npx） */
export type SkillsCliRunner = (args: string[], opts: { cwd: string }) => Promise<SkillsCliResult>

/** 生产执行器：npx -y skills <args...>（非交互，输出全量回收） */
export const defaultSkillsCliRunner: SkillsCliRunner = async (args, { cwd }) => {
    const proc = Bun.spawn(['npx', '-y', 'skills', ...args], {
        cwd,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { ok: exitCode === 0, output: `${stdout}\n${stderr}`.trim() }
}

/** 统一分派尾巴：cwd 定位 + 日志 + 执行（三个 CLI 动作共用，args 构造差异留在各自入口） */
async function dispatchCli(args: string[], scope: SkillScope, runner: SkillsCliRunner, label: string): Promise<SkillsCliResult> {
    const cwd = cliCwd(scope)
    daemonLogger.info(`[skills] ${label}（cwd=${cwd}）`)
    return runner(args, { cwd })
}

/** tracked 路径：分派 skills remove（user 级 -g；project 级 cwd=workspace 让 CLI 自动定位 scope） */
export async function removeTrackedSkill(
    skill: SkillInfo,
    scope: SkillScope,
    runner: SkillsCliRunner,
): Promise<SkillsCliResult> {
    const args = ['remove', skill.name, '-y', '--agent', 'claude-code']
    if (scope.kind === 'global') args.push('-g')
    return dispatchCli(args, scope, runner, `tracked 删除分派 CLI：${skill.name}`)
}

/** 安装：skills add <source>（symlink 形态不传 --copy，只装 claude-code agent） */
export async function installSkill(
    source: string,
    scope: SkillScope,
    runner: SkillsCliRunner,
): Promise<SkillsCliResult> {
    const args = ['add', source, '--agent', 'claude-code']
    if (scope.kind === 'global') args.push('-g')
    return dispatchCli(args, scope, runner, `安装分派 CLI：${source}`)
}

/** 更新（tracked 限定）：skills update（user 级 -g / project 级 -p 显式定 scope） */
export async function updateSkill(
    skill: SkillInfo,
    scope: SkillScope,
    runner: SkillsCliRunner,
): Promise<SkillsCliResult> {
    const args = ['update', skill.name, '-y', '--agent', 'claude-code', scope.kind === 'global' ? '-g' : '-p']
    return dispatchCli(args, scope, runner, `更新分派 CLI：${skill.name}`)
}

/** untracked 路径删除结果：refused = 目标校验失败（不动文件系统） */
export type UntrackedRemoveResult = { ok: true } | { ok: false; error: string }

/**
 * untracked 路径：直接删 agent 目录条目。
 * 目标校验：行携带的 SKILL.md 路径，其父目录必须恰为 <skill 根>/<skill 名>——
 * 与扫描器发现的根一致（personal → claudeConfigDir/skills；project → <ws>/.claude/skills），
 * 不一致说明行数据与磁盘已漂移（TOCTOU），拒绝执行。
 */
export function removeUntrackedSkill(
    skill: SkillInfo,
    roots: SkillScanRoots,
    scope: SkillScope,
): UntrackedRemoveResult {
    const expectedRoot = scopeView(roots, scope).skillRoot

    const dir = dirname(skill.path)
    if (basename(dir) !== skill.name) {
        return { ok: false, error: `Skill directory name mismatch: ${dir}` }
    }
    // realpath 两侧再比对：防 skill 根自身是链接时的绕过
    if (!existsSync(dir) || !existsSync(expectedRoot)) {
        return { ok: false, error: `Skill directory no longer exists: ${dir}` }
    }
    if (realpathSync(dirname(dir)) !== realpathSync(expectedRoot)) {
        return { ok: false, error: `Refusing to delete outside skill root: ${dir}` }
    }

    const stat = lstatSync(dir)
    if (stat.isSymbolicLink()) {
        // symlink 行只删链接——中央仓真身归 CLI 语义（tracked）或用户自管
        unlinkSync(dir)
    } else if (stat.isDirectory()) {
        rmSync(dir, { recursive: true, force: true })
    } else {
        return { ok: false, error: `Not a skill directory: ${dir}` }
    }
    daemonLogger.info(`[skills] untracked 删除：${dir}`)
    return { ok: true }
}
