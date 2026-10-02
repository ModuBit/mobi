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

import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";

/**
 * 桥接 zod 4.4.3 classic schema 与 MCP SDK 1.29 的 AnySchema 约束。
 *
 * SDK registerTool 的 inputSchema 泛型为 `ZodRawShapeCompat | AnySchema` 联合；
 * 本项目 zod 4.4.3 的 z.object(...) 推断为 ZodObject<...,$strip>，因 $strip
 * catchall 的 index signature 缺失，既不满足 z3.ZodTypeAny 也不被联合识别为
 * z4.$ZodType（结构同型但联合不可分配）。此处仅做类型断言，runtime 由 SDK 的
 * zod-compat 正常解析；仍保留对 registerTool 回调返回类型的完整检查
 * （优于 registerTool<any,any> 整体退化为 any-any 而关闭 cb 检查）。
 */
export function asMcpInputSchema<T>(schema: T): AnySchema {
    return schema as unknown as AnySchema;
}
