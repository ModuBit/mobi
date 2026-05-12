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
 * Low-level difftastic wrapper - just arguments in, string out
 */

import { spawn } from 'child_process';
import { resolveBinaryPath } from '@/utils/resolveBinaryPath';

export interface DifftasticResult {
    exitCode: number
    stdout: string
    stderr: string
}

export interface DifftasticOptions {
    cwd?: string
}

/**
 * Run difftastic with the given arguments
 */
export function run(args: string[], options?: DifftasticOptions): Promise<DifftasticResult> {
    const binaryPath = resolveBinaryPath('difft');

    return new Promise((resolve, reject) => {
        const child = spawn(binaryPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options?.cwd,
            env: {
                ...process.env,
                FORCE_COLOR: '1'
            }
        });

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
