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

import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type McpConfigArg = {
    value: string;
    cleanup?: () => void;
};

export type McpConfigOptions = {
    useFile?: boolean;
    baseDir?: string;
};

export function resolveMcpConfigArg(
    mcpServers: Record<string, unknown>,
    options?: McpConfigOptions
): McpConfigArg {
    const configJson = JSON.stringify({ mcpServers });
    const useFile = options?.useFile ?? process.platform === 'win32';
    if (!useFile) {
        return { value: configJson };
    }

    const dir = options?.baseDir ?? tmpdir();
    mkdirSync(dir, { recursive: true });

    const filePath = join(
        dir,
        `mcp-config-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
    );
    writeFileSync(filePath, configJson, "utf8");

    return {
        value: filePath,
        cleanup: () => {
            try {
                unlinkSync(filePath);
            } catch {
                // Ignore cleanup errors; config file is optional and short-lived.
            }
        }
    };
}

export function appendMcpConfigArg(
    args: string[],
    mcpServers?: Record<string, unknown>,
    options?: McpConfigOptions
): (() => void) | null {
    if (!mcpServers || Object.keys(mcpServers).length === 0) {
        return null;
    }

    const { value, cleanup } = resolveMcpConfigArg(mcpServers, options);
    args.push('--mcp-config', value);
    return cleanup ?? null;
}
