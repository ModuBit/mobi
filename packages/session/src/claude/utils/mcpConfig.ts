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
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";

export type McpConfigArg = {
    value: string;
    cleanup?: () => void;
};

export type McpConfigOptions = {
    useFile?: boolean;
    baseDir?: string;
};

/**
 * 判别 SDK in-process MCP server 条目（type 判别字段为 'sdk'）。
 * 此类条目携带活的 McpServer 实例，不可 JSON 序列化；且 local 模式（spawn claude CLI）
 * 没有 toolAliases 机制、不做 web 工具替换，序列化前直接过滤。
 */
function isSdkMcpServer(value: unknown): value is McpSdkServerConfigWithInstance {
    return (
        typeof value === 'object' &&
        value !== null &&
        (value as { type?: unknown }).type === 'sdk'
    );
}

/** 过滤掉 SDK in-process server 条目，仅保留可 JSON 序列化的 mcpServers 子集 */
function filterSerializableMcpServers(
    mcpServers: Record<string, unknown>
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(mcpServers).filter(([, v]) => !isSdkMcpServer(v))
    );
}

export function resolveMcpConfigArg(
    mcpServers: Record<string, unknown>,
    options?: McpConfigOptions
): McpConfigArg {
    const configJson = JSON.stringify({
        mcpServers: filterSerializableMcpServers(mcpServers),
    });
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
    // 过滤后为空（含未传 / 全部为 SDK server）时不追加 --mcp-config（spawn CLI 无对应机制）
    if (!mcpServers || Object.keys(filterSerializableMcpServers(mcpServers)).length === 0) {
        return null;
    }

    const { value, cleanup } = resolveMcpConfigArg(mcpServers, options);
    args.push('--mcp-config', value);
    return cleanup ?? null;
}
