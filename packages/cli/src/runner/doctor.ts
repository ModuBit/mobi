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
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { killProcess } from '@/utils/process';

export interface MobiProcess {
  pid: number
  command: string
  type: string
  /** 进程所属 profile（从 MOBI_HOME 环境变量或 runner state 推断） */
  profile?: string
}

const DEFAULT_MOBI_HOME = join(homedir(), '.mobi')

/**
 * 根据名称获取 MOBI_HOME 路径
 * default → ~/.mobi，dev → ~/.mobi-dev，e2e → ~/.mobi-e2e
 */
export function getMobiHomeForProfile(profile: string): string {
  return profile === 'default'
    ? DEFAULT_MOBI_HOME
    : join(homedir(), `.mobi-${profile}`)
}

/**
 * 从 runner state 文件读取 runner PID
 */
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
 * 从 /proc/<pid>/environ 读取 MOBI_HOME 并反推 profile 名称
 * 注意：/proc/<pid>/environ 是 exec 时的快照，运行时 process.env 修改不会反映
 * 对于 Runner 的子进程（session CLI），MOBI_HOME 在 exec 时就已设置（继承自父进程）
 */
async function getProcessProfile(pid: number): Promise<string | undefined> {
  try {
    const environ = await readFile(`/proc/${pid}/environ`, 'utf8')
    const mobiHome = environ.split('\0')
      .find(e => e.startsWith('MOBI_HOME='))
      ?.slice('MOBI_HOME='.length)
      ?.replace(/^~/, homedir())

    if (!mobiHome || mobiHome === DEFAULT_MOBI_HOME) return 'default'

    const match = mobiHome.match(/\.mobi-(.+)$/)
    return match?.[1] ?? 'default'
  } catch {
    return undefined
  }
}

const RUNNABLE_TYPES = new Set([
  'runner', 'dev-runner',
  'runner-spawned-session', 'dev-runner-spawned',
  'runner-version-check', 'dev-runner-version-check',
])

/**
 * Find all MOBI CLI processes (including current process)
 */
export async function findAllMobiProcesses(): Promise<MobiProcess[]> {
  try {
    const processes = await psList();
    const allProcesses: MobiProcess[] = [];

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
      } else if (cmd.includes('--started-by runner')) {
        type = isDevMode ? 'dev-runner-spawned' : 'runner-spawned-session';
      } else if (cmd.includes('doctor')) {
        type = isDevMode ? 'dev-doctor' : 'doctor';
      } else if (cmd.includes('--yolo')) {
        type = 'dev-session';
      } else {
        type = isDevMode ? 'dev-related' : 'user-session';
      }

      const profile = await getProcessProfile(proc.pid)
      allProcesses.push({ pid: proc.pid, command: cmd || name, type, profile });
    }

    return allProcesses;
  } catch (error) {
    return [];
  }
}

/**
 * 匹配进程是否属于指定 profile
 * 策略：environ 检测 + runner state PID 匹配
 */
function matchesProfile(proc: MobiProcess, profile: string, runnerPids: Set<number>): boolean {
  // 1. environ 中 MOBI_HOME 匹配（子进程有效）
  if (proc.profile === profile) return true
  // 2. Runner state 文件中的 PID 匹配（Runner 进程本身）
  if (runnerPids.has(proc.pid)) return true
  return false
}

/**
 * Find all runaway MOBI CLI processes that should be killed
 * @param profile 只清理指定 profile 的进程，不传则清理全部
 */
export async function findRunawayMobiProcesses(profile?: string): Promise<Array<{ pid: number, command: string }>> {
  const allProcesses = await findAllMobiProcesses();

  // 通过 runner state 文件关联 Runner PID 到 profile
  let runnerPids = new Set<number>()
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

/**
 * Kill all runaway MOBI CLI processes
 * @param profile 只清理指定 profile 的进程，不传则清理全部
 */
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
