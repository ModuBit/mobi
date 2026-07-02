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
 * RPC 二进制传输相关常量（cli 读文件分片 / hub 流式转发 / bun-engine 传输上限）。
 *
 * 集中在 shared 作为单一事实源，避免 cli 的 FILE_RANGE_CHUNK 与 hub 的 maxHttpBufferSize
 * 形成跨包隐式契约（之前仅靠注释维系，调一端不报错、首传大文件时 'payload too large' 断连）。
 */

/**
 * 单次 readFileRange / uploadFileRange RPC 的二进制 chunk 大小（2 MiB）。
 * cli 按此切片读文件、hub 按此流式转发。
 */
export const RPC_BINARY_CHUNK_SIZE = 2 * 1024 * 1024

/**
 * bun-engine / socket.io 单条消息传输上限（4 MB，十进制）。
 *
 * 必须 > {@link RPC_BINARY_CHUNK_SIZE} 留余量（含 RPC 协议封装开销），否则 cli 回传 chunk
 * 会触发 'payload too large' 断开连接（transport close），表现为图片/视频/PDF 预览 body 为空。
 * 注意：此选项必须直接设在 bun-engine 构造参数上，`io.bind(外部 engine)` 不会透传
 * `new Server({ maxHttpBufferSize })` 的同名选项。
 */
export const RPC_MAX_HTTP_BUFFER_SIZE = 4e6
