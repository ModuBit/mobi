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
 * Low-level ripgrep wrapper - just arguments in, string out
 */

import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { platform } from 'os';
import { runtimePath } from '@/projectPath';
import { withBunRuntimeEnv } from '@/utils/bunRuntime';

export interface RipgrepResult {
    exitCode: number
    stdout: string
    stderr: string
}

export interface RipgrepOptions {
    cwd?: string
}

function getBinaryPath(): string {
    const platformName = platform();
    const binaryName = platformName === 'win32' ? 'rg.exe' : 'rg';
    return resolve(join(runtimePath(), 'tools', 'unpacked', binaryName));
}

function spawnRipgrep(args: string[], cwd?: string) {
    return spawn(getBinaryPath(), args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        env: withBunRuntimeEnv()
    });
}

export function run(args: string[], options?: RipgrepOptions): Promise<RipgrepResult> {
    return new Promise((resolve, reject) => {
        const child = spawnRipgrep(args, options?.cwd);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            resolve({
                exitCode: code || 0,
                stdout,
                stderr
            });
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * 流式执行 ripgrep，逐行回调，返回 false 时提前终止进程
 */
export function runStream(
    args: string[],
    onLine: (line: string) => boolean,
    options?: RipgrepOptions,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawnRipgrep(args, options?.cwd);

        let buffer = '';
        let stopped = false;

        child.stdout.on('data', (data: Buffer) => {
            if (stopped) return;

            buffer += data.toString();
            let newlineIdx: number;
            while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIdx);
                buffer = buffer.slice(newlineIdx + 1);
                if (line.length > 0) {
                    if (!onLine(line)) {
                        stopped = true;
                        child.kill();
                        return;
                    }
                }
            }
        });

        child.stderr.on('data', () => {});

        child.on('close', () => {
            if (!stopped && buffer.length > 0) {
                onLine(buffer);
            }
            resolve();
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}
