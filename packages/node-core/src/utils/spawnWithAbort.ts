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

import { spawn, type SpawnOptions, type StdioOptions } from 'node:child_process';
import { logger } from '@/ui/logger';
import { killProcessByChildProcess } from '@/utils/process';

const DEFAULT_ABORT_EXIT_CODES = [130, 137, 143];
const DEFAULT_ABORT_SIGNALS: NodeJS.Signals[] = ['SIGTERM'];

const isAbortError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const maybeError = error as { name?: string; code?: string };
    return maybeError.name === 'AbortError' || maybeError.code === 'ABORT_ERR';
};

export type SpawnWithAbortOptions = {
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal: AbortSignal;
    logLabel: string;
    spawnName: string;
    installHint: string;
    /** ENOENT 等启动失败时追加到错误消息末尾的恢复建议（如 escape hatch 环境变量） */
    recoveryHint?: string;
    abortKillTimeoutMs?: number;
    abortExitCodes?: number[];
    abortSignals?: NodeJS.Signals[];
    includeCause?: boolean;
    logExit?: boolean;
    shell?: SpawnOptions['shell'];
    stdio?: StdioOptions;
};

export async function spawnWithAbort(options: SpawnWithAbortOptions): Promise<void> {
    const abortKillTimeoutMs = options.abortKillTimeoutMs ?? 5000;
    const abortExitCodes = options.abortExitCodes ?? DEFAULT_ABORT_EXIT_CODES;
    const abortSignals = options.abortSignals ?? DEFAULT_ABORT_SIGNALS;
    const stdio = options.stdio ?? ['inherit', 'inherit', 'inherit'];
    const logPrefix = options.logLabel ? `[${options.logLabel}] ` : '';

    const logDebug = (message: string, ...args: unknown[]) => {
        logger.debug(`${logPrefix}${message}`, ...args);
    };

    await new Promise<void>((resolve, reject) => {
        // Note: We intentionally do NOT pass signal to spawn() because Node.js's
        // built-in abort handling only kills the direct child, not grandchildren.
        // Instead, we handle abort ourselves using killProcessByChildProcess which
        // kills the entire process tree to prevent orphan processes.
        const child = spawn(options.command, options.args, {
            stdio,
            cwd: options.cwd,
            env: options.env,
            shell: options.shell
        });

        let abortKillTimeout: NodeJS.Timeout | null = null;

        const abortHandler = () => {
            if (abortKillTimeout) {
                return;
            }
            // First, try graceful termination of entire process tree
            if (child.exitCode === null && !child.killed) {
                logDebug(`Abort signal received, killing process tree (pid=${child.pid}) with SIGTERM`);
                // Note: We don't await here because we're in a sync callback,
                // but killProcessByChildProcess now waits for processes to die internally
                void killProcessByChildProcess(child, false);
            }
            // Set timeout for forceful kill if graceful doesn't work
            abortKillTimeout = setTimeout(() => {
                if (child.exitCode === null && !child.killed) {
                    logDebug('Abort timeout reached, sending SIGKILL');
                    try {
                        void killProcessByChildProcess(child, true);
                    } catch (error) {
                        logDebug('Failed to send SIGKILL', error);
                    }
                }
            }, abortKillTimeoutMs);
        };

        if (options.signal.aborted) {
            abortHandler();
        } else {
            options.signal.addEventListener('abort', abortHandler);
        }

        const cleanupAbortHandler = () => {
            if (abortKillTimeout) {
                clearTimeout(abortKillTimeout);
                abortKillTimeout = null;
            }
            options.signal.removeEventListener('abort', abortHandler);
        };

        child.on('error', (error) => {
            cleanupAbortHandler();
            if (options.signal.aborted && isAbortError(error)) {
                logDebug('Spawn aborted while switching');
                if (!child.pid) {
                    resolve();
                }
                return;
            }
            if (options.signal.aborted) {
                resolve();
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            const errorMessage = `Failed to spawn ${options.spawnName}: ${message}. ` +
                `Is ${options.installHint} installed and on PATH?` +
                (options.recoveryHint ? ` ${options.recoveryHint}` : '');
            if (options.includeCause) {
                reject(new Error(errorMessage, { cause: error }));
            } else {
                reject(new Error(errorMessage));
            }
        });

        child.on('exit', (code, signal) => {
            cleanupAbortHandler();
            if (options.logExit) {
                logDebug(`Child exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}, aborted=${options.signal.aborted})`);
            }
            if (options.signal.aborted && signal && abortSignals.includes(signal)) {
                resolve();
                return;
            }
            if (options.signal.aborted && typeof code === 'number' && abortExitCodes.includes(code)) {
                resolve();
                return;
            }
            if (signal) {
                reject(new Error(`Process terminated with signal: ${signal}`));
                return;
            }
            if (typeof code === 'number' && code !== 0) {
                reject(new Error(`Process exited with code: ${code}`));
                return;
            }
            resolve();
        });
    });
}
