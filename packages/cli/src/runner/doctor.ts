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
    const match = text.match(/MOBI_HOME=([^\s\0]+)/)
    if (!match) return 'default'
    const mobiHome = match[1].replace(/^~/, homedir())
    if (mobiHome === DEFAULT_MOBI_HOME) return 'default'
    const m = mobiHome.match(/\.mobi-(.+)$/)
    return m?.[1] ?? 'default'
}

/** 进程 → profile 名的归属函数签名（可注入便于测试） */
export type ProfileAttributor = (pid: number) => Promise<string | undefined>

/**
 * 反推进程所属 profile。
 *
 * - Linux：读 /proc/<pid>/environ（exec 时的 env 快照）
 * - macOS：`ps -E -o command= -p <pid>` 把环境变量追加在 command 后
 * - 其它平台（如 Windows）：不支持，返回 undefined
 *
 * 读到的文本经 deriveProfileFromEnvText 归约；读取失败返回 undefined（不归属）。
 */
async function getProcessProfile(pid: number): Promise<string | undefined> {
    try {
        let text: string | undefined
        if (process.platform === 'linux') {
            text = await readFile(`/proc/${pid}/environ`, 'utf8')
        } else if (process.platform === 'darwin') {
            text = execSync(`ps -E -o command= -p ${pid}`, {
                encoding: 'utf8',
                timeout: 2_000,
                stdio: ['ignore', 'pipe', 'ignore'],
            })
        } else {
            return undefined
        }
        return text ? deriveProfileFromEnvText(text) : undefined
    } catch {
        return undefined
    }
}

const RUNNABLE_TYPES = new Set([
  'runner', 'dev-runner',
  'hub', 'dev-hub',
  'runner-spawned-session', 'dev-runner-spawned',
  'runner-version-check', 'dev-runner-version-check',
])

export async function findAllMobiProcesses(attributor: ProfileAttributor = getProcessProfile): Promise<MobiProcess[]> {
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

      const profiles = await Promise.all(candidates.map(c => attributor(c.proc.pid)))

    return candidates.map((c, i) => ({
      pid: c.proc.pid,
      command: c.cmd || c.name,
      type: c.type,
      profile: profiles[i],
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

export async function findRunawayMobiProcesses(profile?: string, attributor: ProfileAttributor = getProcessProfile): Promise<Array<{ pid: number, command: string }>> {
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
