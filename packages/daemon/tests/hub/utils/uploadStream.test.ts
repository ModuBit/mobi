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

import { describe, test, expect } from 'bun:test'
import {
    streamUpload,
    concatBytes,
    UPLOAD_CHUNK_SIZE,
    type ByteReader,
    type WriteRangeResult,
} from '../../src/web/utils/uploadStream'

/**
 * 构造 fake reader：逐个返回 chunks；breakAt 指定第几次 read 抛错（模拟连接中断）
 */
function makeReader(chunks: Uint8Array[], breakAt?: number): ByteReader {
    let i = 0
    return {
        read: async () => {
            if (breakAt !== undefined && i === breakAt) {
                throw new Error('reader broke')
            }
            if (i >= chunks.length) return { done: true }
            return { done: false, value: chunks[i++] }
        },
    }
}

describe('concatBytes', () => {
    test('合并多个 Uint8Array', () => {
        const out = concatBytes([new Uint8Array([1, 2]), new Uint8Array([3])])
        expect(Array.from(out)).toEqual([1, 2, 3])
    })

    test('空数组返回空', () => {
        expect(concatBytes([]).length).toBe(0)
    })

    test('单元素直接返回同一引用', () => {
        const a = new Uint8Array([1])
        expect(concatBytes([a])).toBe(a)
    })
})

describe('streamUpload', () => {
    test('正常流式：转发 + 返回首块 path，成功不清理', async () => {
        const chunks = [
            new Uint8Array([1, 2, 3]),
            new Uint8Array([4, 5]),
            new Uint8Array([6, 7, 8, 9, 10]),
        ]
        let writeCalls = 0
        let cleanupCalled = false
        const writeRange = async (
            _fn: string, _path: string | undefined, offset: number, _chunk: Uint8Array,
        ): Promise<WriteRangeResult> => {
            writeCalls++
            if (offset === 0) return { success: true, path: '.mobi/uploads/x.png' }
            return { success: true }
        }
        const cleanup = async () => { cleanupCalled = true }

        const path = await streamUpload(makeReader(chunks), 'f.png', 10, writeRange, cleanup)
        expect(path).toBe('.mobi/uploads/x.png')
        expect(writeCalls).toBeGreaterThan(0)
        expect(cleanupCalled).toBe(false)
    })

    test('聚合到 CHUNK_SIZE：大块独立、小尾合并', async () => {
        const big = new Uint8Array(UPLOAD_CHUNK_SIZE)
        const chunks = [big, big, big, new Uint8Array([1, 2, 3])]
        let writeCalls = 0
        const writeRange = async (
            _fn: string, _path: string | undefined, offset: number,
        ): Promise<WriteRangeResult> => {
            writeCalls++
            if (offset === 0) return { success: true, path: 'p' }
            return { success: true }
        }
        await streamUpload(
            makeReader(chunks), 'f', UPLOAD_CHUNK_SIZE * 3 + 3, writeRange, async () => {},
        )
        // 3 个 big 各 read 后立即达 CHUNK 触发 flush（3 次），小尾在 done 时 flush（1 次）
        expect(writeCalls).toBe(4)
    })

    test('cli 首块拒绝（success:false）→ 抛错（无 path 不清理）', async () => {
        const writeRange = async (): Promise<WriteRangeResult> => ({ success: false, error: 'File too large' })
        let cleanupCalled = false
        await expect(
            streamUpload(
                makeReader([new Uint8Array([1, 2, 3])]), 'f', 3, writeRange, async () => { cleanupCalled = true },
            ),
        ).rejects.toThrow('File too large')
        // 首块 success:false 未返回 path → cleanup 不调（无半成品可删）
        expect(cleanupCalled).toBe(false)
    })

    test('首块成功、后续块失败 → cleanup 删半成品', async () => {
        const big1 = new Uint8Array(UPLOAD_CHUNK_SIZE)
        const big2 = new Uint8Array(UPLOAD_CHUNK_SIZE)
        let call = 0
        let cleanedPath: string | null = null
        const writeRange = async (
            _fn: string, _path: string | undefined, _offset: number,
        ): Promise<WriteRangeResult> => {
            call++
            if (call === 1) return { success: true, path: 'half.png' }
            return { success: false, error: 'rejected' }
        }
        const cleanup = async (p: string) => { cleanedPath = p }
        await expect(
            streamUpload(
                makeReader([big1, big2]), 'f', UPLOAD_CHUNK_SIZE * 2, writeRange, cleanup,
            ),
        ).rejects.toThrow('rejected')
        expect(cleanedPath as string | null).toBe('half.png')
    })

    test('reader 中断（抛错）→ cleanup 删已写半成品', async () => {
        const big1 = new Uint8Array(UPLOAD_CHUNK_SIZE)
        let cleanedPath: string | null = null
        const writeRange = async (
            _fn: string, _path: string | undefined, offset: number,
        ): Promise<WriteRangeResult> => {
            if (offset === 0) return { success: true, path: 'partial.png' }
            return { success: true }
        }
        const cleanup = async (p: string) => { cleanedPath = p }
        // big1（>=CHUNK）read 后 flush 成功（path='partial.png'），第二次 read 抛错
        await expect(
            streamUpload(
                makeReader([big1, new Uint8Array(UPLOAD_CHUNK_SIZE)], 1),
                'f', UPLOAD_CHUNK_SIZE * 2, writeRange, cleanup,
            ),
        ).rejects.toThrow('reader broke')
        expect(cleanedPath as string | null).toBe('partial.png')
    })

    test('不完整（写入字节 ≠ totalSize）→ 抛错 + cleanup', async () => {
        let cleanedPath: string | null = null
        const writeRange = async (
            _fn: string, _path: string | undefined, offset: number,
        ): Promise<WriteRangeResult> => {
            if (offset === 0) return { success: true, path: 'p' }
            return { success: true }
        }
        const cleanup = async (p: string) => { cleanedPath = p }
        // 只发 2 字节，但 totalSize 声明 10
        await expect(
            streamUpload(makeReader([new Uint8Array([1, 2])]), 'f', 10, writeRange, cleanup),
        ).rejects.toThrow('incomplete')
        expect(cleanedPath as string | null).toBe('p')
    })
})
