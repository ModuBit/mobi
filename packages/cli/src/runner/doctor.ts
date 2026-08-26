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
 * Runner doctor utilities
 *
 * Process discovery and cleanup functions for the runner
 * Helps diagnose and fix issues with hung or orphaned processes
 */

import psList from 'ps-list';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { killProcess } from '@/utils/process';

export interface MobiProcess {
  pid: number
  command: string
  type: string
  profile?: string
}

const DEFAULT_MOBI_HOME = join(homedir(), '.mobi')

export function getMobiHomeForProfile(profile: string): string {
  return profile === 'default'
    ? DEFAULT_MOBI_HOME
    : join(homedir(), `.mobi-${profile}`)
}

async function readRunnerPid(mobiHome: string): Promise<number | undefined> {
  try {
    const statePath = join(mobiHome, 'runner.state.json')
    if (!existsSync(statePath)) return undefined
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    return state.pid
  } catch {
    return undefined
  }
}

/**
 * 从进程环境文本归约 profile 名（纯函数）。
 *
 * 兼容两种来源文本：
 * - Linux `/proc/<pid>/environ`：\0 分隔的 KEY=VALUE
 * - macOS `ps -E -o command=`：环境变量追加在 command 后，空格分隔的 KEY=VALUE
 *
 * 归约规则（与 dev.env 的 MOBI_HOME=~/.mobi-<name> 约定一致）：
 * - 无 MOBI_HOME → 进程未显式设 home，走默认 home → 'default'
 * - MOBI_HOME 等于默认 home → 'default'
 * - MOBI_HOME 匹配 ~/.mobi-<name> → '<name>'；非约定路径回退 'default'
 */
export function deriveProfileFromEnvText(text: string): string {
    // [^\s\0] 同时挡 macOS 的空格分隔与 Linux /proc 的 \0 分隔，避免跨字段捕获
    // 取最后一个匹配：macOS ps -E 的 env 追加在 argv 之后，若 argv 偶然含 MOBI_HOME=
    // 字面量（如某 flag 的参数值），首个匹配会污染 profile，故取末尾的真实 env
    const matches = text.match(/MOBI_HOME=([^\s\0]+)/g)
    if (!matches) return 'default'
    const mobiHome = matches[matches.length - 1].slice('MOBI_HOME='.length).replace(/^~/, homedir())
    if (mobiHome === DEFAULT_MOBI_HOME) return 'default'
    const m = mobiHome.match(/\.mobi-(.+)$/)
    return m?.[1] ?? 'default'
}

/** 进程 → profile 名的归属函数签名（批量，可注入便于测试）。
 *  批量接口让默认实现可一次 ps 取回所有候选 pid，避免 per-pid 同步 execSync 阻塞事件循环。 */
export type ProfileAttributor = (pids: number[]) => Promise<Map<number, string | undefined>>

/**
 * 批量反推多个进程所属 profile。
 *
 * - Linux：并行读 `/proc/<pid>/environ`（异步 readFile，本就不阻塞事件循环）
 * - macOS：一次 `ps -E -o pid= -o command= -p <pid1,pid2,...>` 把环境变量随 command 取回
 * - 其它平台（如 Windows）：不支持，返回空 Map
 *
 * 读到的文本经 deriveProfileFromEnvText 归约；单个 pid 读取失败不写入 Map（不归属）。
 * 候选 pid 为空时直接返回，不调用 ps。
 */
async function getProcessProfiles(pids: number[]): Promise<Map<number, string | undefined>> {
    const result = new Map<number, string | undefined>()
    if (pids.length === 0) return result

    if (process.platform === 'linux') {
        await Promise.all(pids.map(async (pid) => {
            try {
                const text = await readFile(`/proc/${pid}/environ`, 'utf8')
                result.set(pid, text ? deriveProfileFromEnvText(text) : undefined)
            } catch {
                // 进程已退出或无权限 → 不归属
            }
        }))
        return result
    }

    if (process.platform === 'darwin') {
        try {
            // 一次 ps 取回所有候选 pid 的 command+env（-E 追加 env，pid=/command= 抑制列头）
            const text = execSync(`ps -E -o pid= -o command= -p ${pids.join(',')}`, {
                encoding: 'utf8',
                timeout: 2_000,
                stdio: ['ignore', 'pipe', 'ignore'],
            })
            for (const line of text.split('\n')) {
                // pid 右对齐有前导空格；其余为 argv + env
                const m = line.match(/^\s*(\d+)\s+(.*)$/)
                if (!m) continue
                const pid = Number(m[1])
                result.set(pid, m[2] ? deriveProfileFromEnvText(m[2]) : undefined)
            }
        } catch {
            // ps 失败（如 pid 全部已退出）→ 全部不归属
        }
        return result
    }

    return result
}

const RUNNABLE_TYPES = new Set([
  'runner', 'dev-runner',
  'hub', 'dev-hub',
  'supervisor', 'dev-supervisor',
  'runner-spawned-session', 'dev-runner-spawned',
  'runner-version-check', 'dev-runner-version-check',
])

export async function findAllMobiProcesses(attributor: ProfileAttributor = getProcessProfiles): Promise<MobiProcess[]> {
  try {
    const processes = await psList();
    const candidates: Array<{ proc: typeof processes[0]; cmd: string; name: string; type: string }> = [];

    for (const proc of processes) {
      const cmd = proc.cmd || '';
      const name = proc.name || '';

      const isMobiBinary = name === 'mobi' || name === 'mobi.exe' || /\bmobi(\.exe)?\b/.test(cmd);
      const isDevMode = cmd.includes('src/index.ts');
      const isMobi = name.includes('Mobi') ||
                      name === 'node' && cmd.includes('mobi') ||
                      cmd.includes('Mobi-coder') ||
                      isMobiBinary ||
                      isDevMode;

      if (!isMobi) continue;

      let type = 'unknown';
      if (proc.pid === process.pid) {
        type = 'current';
      } else if (cmd.includes('--version')) {
        type = isDevMode ? 'dev-runner-version-check' : 'runner-version-check';
      } else if (cmd.includes('runner start-sync') || cmd.includes('runner start')) {
        type = isDevMode ? 'dev-runner' : 'runner';
      } else if (cmd.includes('hub start-sync') || cmd.includes('hub start')) {
        type = isDevMode ? 'dev-hub' : 'hub';
      } else if (cmd.includes('service supervise')) {
        // supervisor 常驻进程必须可被 doctor clean 识别，否则 E2E/dev 清理脚本
        // 绕过它强杀子进程后会残留"无子进程却永不退出"的幽灵（profile 归属
        // 靠 ps -E 读 env 的 MOBI_HOME，supervisor 由 CLI spawn 时继承）
        type = isDevMode ? 'dev-supervisor' : 'supervisor';
      } else if (cmd.includes('--started-by runner')) {
        type = isDevMode ? 'dev-runner-spawned' : 'runner-spawned-session';
      } else if (cmd.includes('doctor')) {
        type = isDevMode ? 'dev-doctor' : 'doctor';
      } else if (cmd.includes('--yolo')) {
        type = 'dev-session';
      } else {
        type = isDevMode ? 'dev-related' : 'user-session';
      }

      candidates.push({ proc, cmd, name, type });
    }

    // 一次性批量归属，避免 per-pid 同步 execSync 串行阻塞
    const profiles = await attributor(candidates.map(c => c.proc.pid))

    return candidates.map((c) => ({
      pid: c.proc.pid,
      command: c.cmd || c.name,
      type: c.type,
      profile: profiles.get(c.proc.pid),
    }));
  } catch (_error) {
    return [];
  }
}

function matchesProfile(proc: MobiProcess, profile: string, runnerPids: Set<number>): boolean {
  if (proc.profile === profile) return true
  if (runnerPids.has(proc.pid)) return true
  return false
}

export async function findRunawayMobiProcesses(profile?: string, attributor: ProfileAttributor = getProcessProfiles): Promise<Array<{ pid: number, command: string }>> {
  const allProcesses = await findAllMobiProcesses(attributor);

  const runnerPids = new Set<number>()
  if (profile) {
    const mobiHome = getMobiHomeForProfile(profile)
    const pid = await readRunnerPid(mobiHome)
    if (pid) runnerPids.add(pid)
  }

  return allProcesses
    .filter(p =>
      p.pid !== process.pid &&
      RUNNABLE_TYPES.has(p.type) &&
      (!profile || matchesProfile(p, profile, runnerPids))
    )
    .map(p => ({ pid: p.pid, command: p.command }));
}

export async function killRunawayMobiProcesses(profile?: string): Promise<{ killed: number, errors: Array<{ pid: number, error: string }> }> {
  const runawayProcesses = await findRunawayMobiProcesses(profile);
  const errors: Array<{ pid: number, error: string }> = [];
  let killed = 0;

  for (const { pid, command } of runawayProcesses) {
    try {
      console.log(`Killing runaway process PID ${pid}: ${command}`);

      await killProcess(pid, false);

      await new Promise(resolve => setTimeout(resolve, 1000));

      const processes = await psList();
      const stillAlive = processes.find(p => p.pid === pid);
      if (stillAlive) {
        console.log(`Process PID ${pid} ignored termination request, using force kill`);
        await killProcess(pid, true);
      }

      console.log(`Successfully killed runaway process PID ${pid}`);
      killed++;
    } catch (error) {
      const errorMessage = (error as Error).message;
      errors.push({ pid, error: errorMessage });
      console.log(`Failed to kill process PID ${pid}: ${errorMessage}`);
    }
  }

  return { killed, errors };
}
