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
 * 测试用 MCP server：暴露 trigger_elicitation 工具（批次 C E2E，spec §5）。
 * 调用后 server 主动发 form elicitation（string/number/boolean 各一字段），
 * 把用户响应的 content JSON 序列化进工具结果文本，供 web 端断言闭环。
 * stdio transport；仅 E2E 环境经 .mcp.json 引用，不进生产依赖。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/** elicitation 等待超时（server 侧自身超时先到则不再无限挂起） */
const ELICIT_TIMEOUT_MS = 60_000;

const server = new McpServer(
    { name: "elicitation-test-server", version: "0.1.0" },
    { capabilities: { elicitation: {} } }
);

server.registerTool(
    "trigger_elicitation",
    {
        title: "触发表单 elicitation",
        description: "发起一次 form elicitation（string/number/boolean 各一字段），把用户响应回显进工具结果",
        inputSchema: {
            message: z.string().optional().describe("elicitation 展示给用户的消息"),
        },
    },
    async ({ message }) => {
        const result = await Promise.race([
            server.server.elicitInput({
                mode: "form",
                message: message ?? "请填写 elicitation 测试表单",
                requestedSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string", title: "名字" },
                        count: { type: "number", title: "数量" },
                        flag: { type: "boolean", title: "开关" },
                    },
                    required: ["name"],
                },
            }),
            new Promise<{ action: "cancel"; content?: undefined }>((resolve) =>
                setTimeout(() => resolve({ action: "cancel" }), ELICIT_TIMEOUT_MS)
            ),
        ]);

        // 把 action + content 序列化进工具结果文本，供 E2E 断言闭环
        const payload = JSON.stringify({ action: result.action, content: result.content ?? null });
        return { content: [{ type: "text", text: `elicitation-result: ${payload}` }] };
    }
);

await server.connect(new StdioServerTransport());
