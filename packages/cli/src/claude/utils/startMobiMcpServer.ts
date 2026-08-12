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
 * MOBI MCP server
 * Provides MOBI CLI specific tools including chat session title management
 *
 * 使用 stateless 模式：每个 HTTP 请求创建独立的 transport 实例，
 * 兼容 MCP SDK 1.25+ 及以上版本。
 * 参考：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { asMcpInputSchema } from "@/mcp/mcpSchemaCompat";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import { syncClaudeRename, type ClaudeSessionLocator } from "@/claude/utils/renameClaudeSession";

export async function startMobiMcpServer(
    client: ApiSessionClient,
    /** 取当前 Claude 会话定位（sessionId + path），用于回写 CC customTitle */
    getClaudeSession: () => ClaudeSessionLocator | null,
) {
    // Handler that sends title updates via the client
    const handler = async (title: string) => {
        logger.debug('[mobiMCP] Changing title to:', title);
        try {
            // 1. 发 summary 到 Hub（更新 mobi 侧标题 + Web 显示）
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: title,
                leafUuid: randomUUID()
            });

            // 2. best-effort 回写 CC customTitle（会话未就绪/SDK 失败不影响 mobi 侧已完成的改名）
            try {
                await syncClaudeRename(getClaudeSession(), title);
            } catch (renameError) {
                logger.debug('[mobiMCP] 回写 CC 标题失败 (best-effort，忽略):', renameError);
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    //
    // Create the MCP server (工具注册，不预先绑定 transport)
    //

    const mcp = new McpServer({
        name: "MOBI MCP",
        version: "1.0.0",
    });

    const changeTitleInputSchema = asMcpInputSchema(z.object({
        title: z.string().describe('The new title for the chat session'),
    }));

    mcp.registerTool('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: changeTitleInputSchema,
    }, async (args: { title: string }) => {
        const response = await handler(args.title);
        logger.debug('[mobiMCP] Response:', response);

        if (response.success) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Successfully changed chat title to: "${args.title}"`,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    //
    // Create the HTTP server
    // Stateless 模式：每个请求创建独立的 transport 并 connect 到 MCP server
    //

    const server = createServer(async (req, res) => {
        try {
            // 关闭上一次连接（将 _transport 置为 undefined，允许重新 connect）
            // request handlers（工具注册）不会被清除，可以安全复用
            await mcp.close();

            // 每个请求创建独立的 transport（stateless 模式要求）
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined
            });
            await mcp.connect(transport);
            await transport.handleRequest(req, res);
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    return {
        url: baseUrl.toString(),
        toolNames: ['change_title'],
        stop: () => {
            logger.debug('[mobiMCP] Stopping server');
            mcp.close();
            server.close();
        }
    }
}
