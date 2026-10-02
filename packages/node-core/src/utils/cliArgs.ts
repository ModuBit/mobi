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

import { basename } from 'node:path';

function resolveRawArgv(): string[] {
    const bunArgv = globalThis.Bun?.argv;
    if (Array.isArray(bunArgv) && bunArgv.length > 0) {
        return bunArgv;
    }
    return process.argv;
}

function isEntrypointPath(value: string, bunMain: string): boolean {
    if (!value) {
        return false;
    }
    if (value === bunMain) {
        return true;
    }
    return /\.(c|m)?(ts|js)$/.test(value);
}

function hasRuntimeWrapper(preArgs: string[], execPath: string, execBase: string, bunMain: string): boolean {
    if (preArgs.length === 0) {
        return false;
    }
    if (preArgs[0] === 'bun') {
        return true;
    }
    if (preArgs.length < 2) {
        return false;
    }
    if (preArgs[0] !== execPath && preArgs[0] !== execBase) {
        return false;
    }
    return isEntrypointPath(preArgs[1], bunMain);
}

export function normalizeCliArgs(rawArgv: string[]): string[] {
    if (!Array.isArray(rawArgv) || rawArgv.length === 0) {
        return [];
    }

    const execPath = process.execPath;
    const execBase = basename(execPath);
    const bunMain = globalThis.Bun?.main ?? '';
    const dashIndex = rawArgv.indexOf('--');
    let argv = rawArgv.slice();
    if (dashIndex >= 0) {
        const preArgs = rawArgv.slice(0, dashIndex);
        const postArgs = rawArgv.slice(dashIndex + 1);
        argv = hasRuntimeWrapper(preArgs, execPath, execBase, bunMain)
            ? postArgs
            : [...preArgs, ...postArgs];
    }

    let startIndex = 0;
    while (startIndex < argv.length) {
        const value = argv[startIndex] || '';
        const nextValue = argv[startIndex + 1] || '';
        if (
            value === 'bun' &&
            (nextValue === bunMain || nextValue === execPath || nextValue === execBase || isEntrypointPath(nextValue, bunMain))
        ) {
            startIndex += 2;
            continue;
        }
        if (value === execPath || value === execBase || isEntrypointPath(value, bunMain)) {
            startIndex += 1;
            continue;
        }
        break;
    }

    return argv.slice(startIndex);
}

export function getCliArgs(): string[] {
    return normalizeCliArgs(resolveRawArgv());
}
