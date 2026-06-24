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
 * 流式上传管道（对称下载侧 /read-file 流式）：web 二进制 body → hub reader 聚合 → cli writeFileRange。
 * session 与 machine 通道共用，调用方注入 writeRange（转发到对应 RPC）+ cleanup（删半成品）。
 */

/** 聚合粒度：reader 返回的块由网络层决定（可能很小），聚合到 256KB 再 RPC，控制 emitWithAck 次数 */
export const UPLOAD_CHUNK_SIZE = 256 * 1024

/** 单块写入结果（对称 cli writeFileRange 响应） */
export interface WriteRangeResult {
    success: boolean
    /** 首块返回：项目相对路径 */
    path?: string
    error?: string
}

/**
 * 最小字节 reader 接口（兼容 ReadableStreamDefaultReader）。
 * 不直接引用 ReadableStreamDefaultReader<Uint8Array>，避开 DOM/Worker lib 的 readMany 类型冲突。
 */
export interface ByteReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>
}

/** 合并 Uint8Array 数组为单个 Uint8Array */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
    if (parts.length === 0) return new Uint8Array(0)
    if (parts.length === 1) return parts[0]
    const len = parts.reduce((sum, p) => sum + p.length, 0)
    const out = new Uint8Array(len)
    let pos = 0
    for (const p of parts) {
        out.set(p, pos)
        pos += p.length
    }
    return out
}

/**
 * 流式上传：从请求 body reader 逐块读 → 聚合到 UPLOAD_CHUNK_SIZE → 经 writeRange 转发到 cli
 * （emitWithAck 串行 await = 天然背压：cli 没写完上一块，hub 不读下一块，TCP 窗口传导到 web）。
 * 中断（reader 抛错 / cli rpcError / offset≠totalSize）→ 抛出前调 cleanup 删半成品。
 *
 * @param reader 请求 body 的 reader（c.req.raw.body.getReader()）
 * @param filename 首块用：原始文件名
 * @param totalSize Content-Length，完整性校验分母
 * @param writeRange 单块转发回调（filename, path, offset, chunk）→ cli 响应
 * @param cleanup 中断清理回调（path）→ deleteUpload
 * @returns 首块 cli 返回的项目相对路径
 * @throws 上传失败/中断（抛出前已尝试 cleanup）
 */
export async function streamUpload(
    reader: ByteReader,
    filename: string,
    totalSize: number,
    writeRange: (filename: string, path: string | undefined, offset: number, chunk: Uint8Array) => Promise<WriteRangeResult>,
    cleanup: (path: string) => Promise<unknown>,
): Promise<string> {
    let buf: Uint8Array[] = []
    let buffered = 0
    let offset = 0
    let path: string | undefined

    // 聚合 buf → 一次 RPC（减少 emitWithAck 次数）；cli 拒绝则抛出 → 外层 catch 清理
    const flush = async () => {
        const chunk = concatBytes(buf)
        const r = await writeRange(filename, path, offset, chunk)
        if (!r.success) throw new Error(r.error ?? 'upload failed')
        // 首块（offset=0）cli 返回 path，后续块复用
        if (offset === 0 && r.path) path = r.path
        offset += chunk.length
        buf = []
        buffered = 0
    }

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                if (buffered > 0) await flush()
                break
            }
            if (!value) continue
            buf.push(value)
            buffered += value.length
            if (buffered >= UPLOAD_CHUNK_SIZE) await flush()
        }
        // 完整性校验：实际写入字节必须等于声明的 Content-Length
        if (offset !== totalSize) throw new Error('incomplete upload')
        if (!path) throw new Error('upload produced no path')
        return path
    } catch (e) {
        // 任何中断（reader 断开 / cli 拒绝 / 不完整）→ 删半成品，避免遗留损坏文件
        if (path) await cleanup(path).catch(() => {})
        throw e
    }
}
