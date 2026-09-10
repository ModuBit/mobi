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

/** 文件 meta 三元组（文件变化 mtime 必变，etag 随之变化） */
export interface RpcFileMeta {
    mime: string
    size: number
    etag: string
}

/** etag 单点公式（跨端契约：CLI 各读写路径统一经此生成，改动只动这里） */
export function fileEtag(size: number, mtimeMs: number): string {
    return `${size}-${Math.floor(mtimeMs)}`
}

/**
 * readFileMeta RPC 响应（CLI → hub → web 三端单源形状，加字段只改这里）：
 * 结构化 code（'ENOENT'/'ACCESS_DENIED'/...）供 hub 精确分流 HTTP 状态，不依赖文案正则。
 */
export interface ReadFileMetaResponse {
    success: boolean
    meta?: RpcFileMeta
    /** 可写性：路径是否在写边界（严格 cwd 子树）内。false 时 web 端 inspector 直接只读态 */
    writable?: boolean
    error?: string
    code?: string
}

/**
 * readFileRange RPC 响应（CLI → hub → web 三端单源形状，加字段只改这里）：
 * chunk 为单分片二进制（Socket.IO 原生序列化透传）；失败时结构化 code 透传（ENOENT 等）。
 */
export type RpcReadFileRangeResponse =
    | { success: true; chunk: Uint8Array }
    | { success: false; error: string; code?: string }
