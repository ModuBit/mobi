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
 * Cross-platform MOBI CLI spawning utility
 *
 * ## Background
 *
 * MOBI CLI runs in two modes:
 * 1. **Compiled binary**: A single executable built with `bun build --compile`
 * 2. **Development mode**: Running TypeScript directly via `bun`
 *
 * ## Execution Modes
 *
 * **Compiled Binary (Production):**
 * - The executable is self-contained and runs directly
 * - `process.execPath` points to the compiled binary itself
 * - No additional entrypoint needed - just pass args to `process.execPath`
 *
 * **Development Mode:**
 * - Running via `bun src/index.ts`
 * - Spawn child processes using the same runtime with `src/index.ts` entrypoint
 *
 * ## Cross-Platform Support
 *
 * This utility handles spawning MOBI CLI subprocesses (for runner processes)
 * in a cross-platform way, detecting the current runtime mode and using
 * the appropriate command and arguments.
 */

import { spawn, SpawnOptions, type ChildProcess } from 'child_process';
import { join } from 'node:path';
import { isBunCompiled, projectPath } from '@/projectPath';
import { logger } from '@/ui/logger';
import { existsSync } from 'node:fs';

/**
 * Bun 调试器环境变量 key 列表
 * 清理这些变量可避免子进程继承后绑定同一 socket 导致 EADDRINUSE
 * （Bun 的调试器在 JS 代码执行前初始化，进程内 delete process.env 来不及阻止）
 */
export const BUN_DEBUGGER_ENV_KEYS = [
  'BUN_INSPECT',
  'BUN_INSPECT_NOTIFY',
  'BUN_DEBUG_QUIET_LOGS',
  'BUN_QUIET_DEBUG_LOGS',
] as const;

/** 从环境变量中移除 Bun 调试器变量 */
export function stripBunDebuggerEnv(env: Record<string, string | undefined>): void {
  for (const key of BUN_DEBUGGER_ENV_KEYS) {
    delete env[key];
  }
}

/**
 * Resolve the TypeScript entrypoint for development mode.
 */
function resolveEntrypoint(projectRoot: string): string {
  const srcEntrypoint = join(projectRoot, 'src', 'index.ts');
  if (existsSync(srcEntrypoint)) {
    return srcEntrypoint;
  }

  throw new Error('No CLI entrypoint found (expected src/index.ts)');
}

export interface MobiCliCommand {
  command: string;
  args: string[];
}

export function getMobiCliCommand(args: string[]): MobiCliCommand {
  // Compiled binary mode: just use the executable directly
  if (isBunCompiled()) {
    return {
      command: process.execPath,
      args
    };
  }

  // Development mode: spawn with TypeScript entrypoint
  const projectRoot = projectPath();
  const entrypoint = resolveEntrypoint(projectRoot);
  const isBunRuntime = Boolean((process.versions as Record<string, string | undefined>).bun);

  if (isBunRuntime) {
    // Bun can run TypeScript directly
    return {
      command: process.execPath,
      args: [entrypoint, ...args]
    };
  }

  // Node.js fallback: preserve execArgv (for compatibility)
  return {
    command: process.execPath,
    args: [...process.execArgv, entrypoint, ...args]
  };
}

export function spawnMobiCli(args: string[], options: SpawnOptions = {}): ChildProcess {

  let directory: string | URL | undefined;
  if ('cwd' in options) {
    directory = options.cwd
  } else {
    directory = process.cwd()
  }
  // Note: We're executing the current runtime with the calculated entrypoint path below,
  // bypassing the 'mobi' wrapper that would normally be found in the shell's PATH.
  // However, we log it as 'mobi' here because other engineers are typically looking
  // for when "mobi" was started and don't care about the underlying node process
  // details and flags we use to achieve the same result.
  const fullCommand = `mobi ${args.join(' ')}`;
  logger.debug(`[SPAWN MOBI CLI] Spawning: ${fullCommand} in ${directory}`);
  
  const { command: spawnCommand, args: spawnArgs } = getMobiCliCommand(args);

  // Sanity check that the entrypoint path exists
  if (!isBunCompiled()) {
    const entrypoint = spawnArgs.find((arg) => arg.endsWith('index.ts'));
    if (entrypoint && !existsSync(entrypoint)) {
      const errorMessage = `Entrypoint ${entrypoint} does not exist`;
      logger.debug(`[SPAWN MOBI CLI] ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }
  
  // On Windows, detached processes allocate a new console window by default.
  // windowsHide: true suppresses this to prevent cmd windows from accumulating.
  const finalOptions: SpawnOptions = { ...options };
  if (process.platform === 'win32' && options.detached) {
    finalOptions.windowsHide = true;
  }

  // 清理 IDE 调试器环境变量，避免子进程继承后绑定同一 socket 导致 EADDRINUSE
  const childEnv = { ...(finalOptions.env ?? process.env) } as Record<string, string | undefined>;
  stripBunDebuggerEnv(childEnv);
  finalOptions.env = childEnv;

  return spawn(spawnCommand, spawnArgs, finalOptions);
}
