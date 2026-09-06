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
 * MOBI MCP server（local 模式 HTTP transport 适配器）
 *
 * 工具核心逻辑在 changeTitleTool（transport 无关），此处只做 HTTP 壳：
 * 使用 stateless 模式，每个 HTTP 请求创建独立的 transport 实例，
 * 兼容 MCP SDK 1.25+ 及以上版本。remote 模式经 SDK createSdkMcpServer
 * 进程内挂载同一份核心（见 ADR 0001）。
 * 参考：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { asMcpInputSchema } from "@/mcp/mcpSchemaCompat";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import type { AgentSessionLocator } from "@/agent/agentCapabilities";
import { createChangeTitleToolForSession } from "@/mcp/changeTitleTool";

export async function startMobiMcpServer(
    client: ApiSessionClient,
    /** 取当前 agent 会话定位（flavor + sessionId + path），用于回写 agent 侧标题 */
    getAgentLocator: () => AgentSessionLocator | null,
) {
    // 核心工具：组装逻辑收口于 sessionTransports（与 remote 进程内壳共用）
    const changeTitleTool = createChangeTitleToolForSession(client, getAgentLocator);

    //
    // Create the MCP server (工具注册，不预先绑定 transport)
    //

    const mcp = new McpServer({
        name: "MOBI MCP",
        version: "1.0.0",
    });

    mcp.registerTool(changeTitleTool.name, {
        description: changeTitleTool.description,
        title: changeTitleTool.title,
        inputSchema: asMcpInputSchema(changeTitleTool.inputSchema),
    }, async (args: unknown) => changeTitleTool.execute(args));

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
        stop: () => {
            logger.debug('[mobiMCP] Stopping server');
            mcp.close();
            server.close();
        }
    }
}
