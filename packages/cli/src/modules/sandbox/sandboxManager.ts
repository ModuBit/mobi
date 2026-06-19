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

import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    SandboxManager as BaseSandboxManager,
    type SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime'
import { logger } from '@/ui/logger'
import { loadSandboxConfig, type SandboxConfig } from './sandboxConfig'

// ─── 状态（单例模式，仅支持单一 cwd） ───

let available: boolean | null = null
let initialized = false
let initPromise: Promise<void> | null = null
let _currentCwd = ''
let bareGitScrubPaths: string[] = []

// ─── 敏感环境变量（子进程中移除） ───

const SECRET_ENV_PREFIXES = [
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID',
    'GITHUB_TOKEN',
    'GH_TOKEN',
]

// ─── 强制禁止写入的路径（参考 Claude Code sandbox-adapter.ts:231-255） ───

const MANDATORY_DENY_WRITE_PATTERNS = [
    '.bashrc', '.bash_profile', '.zshrc', '.zprofile', '.profile',
    '.gitconfig', '.ripgreprc',
]

const MANDATORY_DENY_WRITE_DIRS = [
    '.git/hooks', '.git/config',
    '.claude/commands', '.claude/agents', '.claude/skills',
    '.vscode', '.idea',
]

// ─── Bare git repo 攻击防护（参考 sandbox-adapter.ts:257-280） ───

const BARE_GIT_FILES = ['HEAD', 'objects', 'refs', 'hooks', 'config']

// ─── Shell 执行结果 ───

export interface ShellResult {
    stdout: string
    stderr: string
    code: number | null
    signal: string | null
    timedOut: boolean
}

// ─── 可用性检查 ───

export function isSandboxAvailable(): boolean {
    if (available !== null) return available

    const config = loadSandboxConfig()
    if (!config.enabled) {
        logger.debug('[sandbox] 沙箱已禁用（sandbox.json: enabled=false）')
        available = false
        return false
    }

    if (!BaseSandboxManager.isSupportedPlatform()) {
        logger.debug('[sandbox] 平台不支持沙箱')
        available = false
        return false
    }

    const depCheck = BaseSandboxManager.checkDependencies()
    if (depCheck.errors.length > 0) {
        logger.warn(`[sandbox] 沙箱依赖缺失: ${depCheck.errors.join(', ')}`)
        logger.warn('[sandbox] 降级到无沙箱模式，建议安装缺失依赖')
        available = false
        return false
    }

    available = true
    return true
}

// ─── 配置转换 ───

interface ConvertedConfig {
    runtimeConfig: SandboxRuntimeConfig
    scrubPaths: string[]
}

function convertToRuntimeConfig(cwd: string, config: SandboxConfig): ConvertedConfig {
    const denyWrite = [...config.filesystem.denyWrite]

    // 强制禁止写入的文件
    for (const pattern of MANDATORY_DENY_WRITE_PATTERNS) {
        const p = resolve(cwd, pattern)
        if (existsSync(p)) denyWrite.push(p)
    }

    // 强制禁止写入的目录
    for (const dir of MANDATORY_DENY_WRITE_DIRS) {
        const p = resolve(cwd, dir)
        if (existsSync(p)) denyWrite.push(p)
    }

    // Bare git repo 攻击防护：存在的加入 denyWrite，不存在的记录为待清理路径
    const scrubPaths: string[] = []
    for (const gitFile of BARE_GIT_FILES) {
        const p = resolve(cwd, gitFile)
        if (existsSync(p)) {
            denyWrite.push(p)
        } else {
            scrubPaths.push(p)
        }
    }

    return {
        runtimeConfig: {
            network: {
                allowedDomains: config.network.allowedDomains,
                deniedDomains: [],
            },
            filesystem: {
                allowWrite: config.filesystem.allowWrite,
                denyWrite,
                denyRead: config.filesystem.denyRead,
                allowRead: [],
            },
        },
        scrubPaths,
    }
}

// ─── 清理 bare git repo 植入文件 ───

function scrubBareGitRepoFiles(): void {
    for (const p of bareGitScrubPaths) {
        try {
            rmSync(p, { recursive: true })
        } catch (e: any) {
            if (e?.code !== 'ENOENT') {
                logger.debug(`[sandbox] 清理失败: ${p}: ${e.message}`)
            }
        }
    }
}

// ─── 环境变量过滤（参考 Shell.ts:79-99） ───

function buildSubprocessEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
        for (const prefix of SECRET_ENV_PREFIXES) {
            if (key === prefix || key.startsWith(prefix + '_')) {
                delete env[key]
                break
            }
        }
    }
    return env
}

// ─── 初始化 ───

export async function initializeSandbox(cwd: string): Promise<void> {
    if (initialized) return
    if (initPromise) return initPromise

    _currentCwd = cwd

    initPromise = (async () => {
        if (!isSandboxAvailable()) return

        try {
            const config = loadSandboxConfig()
            const { runtimeConfig, scrubPaths } = convertToRuntimeConfig(cwd, config)
            bareGitScrubPaths = scrubPaths
            await BaseSandboxManager.initialize(runtimeConfig)
            initialized = true
            logger.debug('[sandbox] 沙箱初始化成功')
        } catch (e) {
            logger.warn(`[sandbox] 初始化失败，降级到无沙箱模式: ${e instanceof Error ? e.message : String(e)}`)
            available = false
        }
    })()

    return initPromise
}

// ─── 命令包裹 ───

export async function wrapCommand(command: string): Promise<string> {
    if (!available || !initialized) return command

    try {
        const wrapped = await BaseSandboxManager.wrapWithSandbox(command)
        return wrapped
    } catch (e) {
        logger.debug(`[sandbox] wrapWithSandbox 失败: ${e instanceof Error ? e.message : String(e)}`)
        return command
    }
}

// ─── 清理 ───

export function cleanupSandbox(): void {
    if (!available || !initialized) return
    BaseSandboxManager.cleanupAfterCommand()
    scrubBareGitRepoFiles()
}

// ─── Shell 检测（缓存结果，进程生命周期内不变） ───

let cachedShell: string | null = null

function detectShell(): string {
    if (cachedShell) return cachedShell
    const userShell = process.env.SHELL
    if (userShell && (userShell.includes('bash') || userShell.includes('zsh'))) {
        if (existsSync(userShell)) {
            cachedShell = userShell
            return cachedShell
        }
    }
    for (const p of ['/bin/zsh', '/bin/bash', '/usr/bin/zsh', '/usr/bin/bash', '/bin/sh']) {
        if (existsSync(p)) {
            cachedShell = p
            return cachedShell
        }
    }
    cachedShell = '/bin/sh'
    return cachedShell
}

// ─── Spawn 执行器（参考 Shell.ts:259-393） ───

export async function spawnWithTimeout(
    command: string,
    options: {
        cwd: string
        timeout: number
        signal?: AbortSignal
    }
): Promise<ShellResult> {
    const { cwd, timeout, signal } = options
    const shell = detectShell()

    return new Promise<ShellResult>((resolve) => {
        const child: ChildProcess = spawn(shell, ['-c', command], {
            cwd,
            env: buildSubprocessEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
        })

        const stdoutDecoder = new StringDecoder('utf-8')
        const stderrDecoder = new StringDecoder('utf-8')
        let stdout = ''
        let stderr = ''
        let timedOut = false
        let timer: ReturnType<typeof setTimeout> | null = null

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer)
                timer = null
            }
            if (signal) {
                signal.removeEventListener('abort', onAbort)
            }
        }

        const onAbort = () => {
            timedOut = true
            child.kill('SIGTERM')
            // SIGKILL 升级：3s 后进程仍存活则强制终止
            setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 错误可忽略：进程可能已退出 */ } }, 3000)
        }

        // 超时
        timer = setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
            // SIGKILL 升级：3s 后进程仍存活则强制终止
            setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 错误可忽略：进程可能已退出 */ } }, 3000)
        }, timeout)

        // Abort signal
        if (signal) {
            if (signal.aborted) {
                cleanup()
                resolve({ stdout: '', stderr: '', code: null, signal: null, timedOut: true })
                return
            }
            signal.addEventListener('abort', onAbort, { once: true })
        }

        // 收集输出
        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += stdoutDecoder.write(chunk)
        })
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += stderrDecoder.write(chunk)
        })

        child.on('close', (code, sig) => {
            cleanup()
            // flush decoder 残余
            stdout += stdoutDecoder.end()
            stderr += stderrDecoder.end()
            resolve({
                stdout,
                stderr,
                code,
                signal: sig,
                timedOut,
            })
        })

        child.on('error', (err) => {
            cleanup()
            resolve({
                stdout,
                stderr: stderr + (stderr ? '\n' : '') + err.message,
                code: 1,
                signal: null,
                timedOut: false,
            })
        })
    })
}
