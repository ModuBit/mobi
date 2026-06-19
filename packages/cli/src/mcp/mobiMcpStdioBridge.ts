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
 * Mobi MCP STDIO Bridge
 *
 * Minimal STDIO MCP server exposing a single tool `change_title`.
 * On invocation it forwards the tool call to an existing Mobi HTTP MCP server
 * using the StreamableHTTPClientTransport.
 *
 * Configure the target HTTP MCP URL via env var `MOBI_HTTP_MCP_URL` or
 * via CLI flag `--url <http://127.0.0.1:PORT>`.
 *
 * Note: This process must not print to stdout as it would break MCP STDIO.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';

function parseArgs(argv: string[]): { url: string | null } {
  let url: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && i + 1 < argv.length) {
      url = argv[i + 1];
      i++;
    }
  }
  return { url };
}

export async function runMobiMcpStdioBridge(argv: string[]): Promise<void> {
  try {
    // Resolve target HTTP MCP URL
    const { url: urlFromArgs } = parseArgs(argv);
    const baseUrl = urlFromArgs || process.env.MOBI_HTTP_MCP_URL || '';

    if (!baseUrl) {
      // Write to stderr; never stdout.
      process.stderr.write(
        '[mobi-mcp] Missing target URL. Set MOBI_HTTP_MCP_URL or pass --url <http://127.0.0.1:PORT>\n'
      );
      process.exit(2);
    }

    let httpClient: Client | null = null;

    async function ensureHttpClient(): Promise<Client> {
      if (httpClient) return httpClient;
      const client = new Client(
        { name: 'mobi-stdio-bridge', version: '1.0.0' },
        { capabilities: {} }
      );

      const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
      await client.connect(transport);
      httpClient = client;
      return client;
    }

    // Create STDIO MCP server
    const server = new McpServer({
      name: 'Mobi MCP Bridge',
      version: '1.0.0',
    });

    // Register the single tool and forward to HTTP MCP
    // 见 startMobiMcpServer.ts 同款注释：MCP SDK 1.29 的 registerTool 泛型约束
    // （ZodRawShapeCompat | AnySchema 联合）与 zod 4.4.3 classic 的 z.object(...) 推断
    // 不兼容，用 `as unknown as AnySchema` 断言桥接（仅类型层面，runtime 由 SDK 解析）。
    const changeTitleInputSchema = z.object({
      title: z.string().describe('The new title for the chat session'),
    }) as unknown as AnySchema;

    server.registerTool(
      'change_title',
      {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: changeTitleInputSchema,
      },
      async (args: Record<string, unknown>) => {
        try {
          const client = await ensureHttpClient();
          // 直接透传 HTTP MCP 服务端返回的 CallToolResult
          // client.callTool 的返回联合包含无 content 的边界分支，强转为 CallToolResult
          return (await client.callTool({ name: 'change_title', arguments: args })) as CallToolResult;
        } catch (error) {
          return {
            content: [
              { type: 'text' as const, text: `Failed to change chat title: ${error instanceof Error ? error.message : String(error)}` },
            ],
            isError: true,
          };
        }
      }
    );

    // Start STDIO transport
    const stdio = new StdioServerTransport();
    await server.connect(stdio);
  } catch (err) {
    try {
      process.stderr.write(`[mobi-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      process.exit(1);
    }
  }
}
