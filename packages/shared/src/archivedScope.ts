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
 * 归档范围（workspaceId 三态）的 wire 编码单源。
 *
 * 三态：缺省 = 全部归档；null = 未归入工作区；字符串 = 指定工作区。
 * query string 装不下 null，故「未归入」用哨兵值传输——编码/解码曾经散在
 * daemon 路由、web client、hook 与归档页四处各写一遍字面量，改哨兵值是静默
 * 降级为「全部」的一类错误，因此收口到 shared：两端只认这一对函数。
 */

/** 「未归入工作区」的 wire 哨兵值（query 参数取值） */
export const ARCHIVED_WORKSPACE_NONE = '__none__'

/** 过滤值 → query 参数：undefined = 全部（不下发）、null = 未归入（哨兵）、其余透传 */
export function encodeArchivedWorkspaceId(scope: string | null | undefined): string | undefined {
    if (scope === undefined) return undefined
    if (scope === null) return ARCHIVED_WORKSPACE_NONE
    return scope
}

/** query 参数 → 过滤值（daemon 侧解码）：缺省/空串 = 全部、哨兵 = 未归入、其余透传 */
export function decodeArchivedWorkspaceId(raw: string | undefined): string | null | undefined {
    if (raw === undefined || raw === '') return undefined
    if (raw === ARCHIVED_WORKSPACE_NONE) return null
    return raw
}
