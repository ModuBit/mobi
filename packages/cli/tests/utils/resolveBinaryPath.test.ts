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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// mock @/projectPath 以控制 runtimePath 返回值
const fakeRuntimeDir = join(tmpdir(), `mobi-test-resolve-${process.pid}`)

vi.mock('@/projectPath', () => ({
    runtimePath: () => fakeRuntimeDir,
    isBunCompiled: () => false,
}))

const unpackedDir = resolve(fakeRuntimeDir, 'tools', 'unpacked')
const { resolveBinaryPath, UNPACKED_PLATFORM_MARKER } = await import('@/utils/resolveBinaryPath')

describe('resolveBinaryPath', () => {
    beforeEach(() => {
        // 每次测试前清空缓存：重新 import 模块
        vi.resetModules()
        rmSync(fakeRuntimeDir, { recursive: true, force: true })
    })

    afterEach(() => {
        rmSync(fakeRuntimeDir, { recursive: true, force: true })
    })

    async function getFreshModule() {
        const mod = await import('@/utils/resolveBinaryPath?t=' + Date.now())
        return mod
    }

    it('unpacked 二进制不存在时回退到系统 PATH', async () => {
        const { resolveBinaryPath } = await getFreshModule()
        expect(resolveBinaryPath('rg')).toBe('rg')
    })

    it('有 unpacked 二进制 + 平台标记时使用打包路径', async () => {
        mkdirSync(unpackedDir, { recursive: true })
        writeFileSync(join(unpackedDir, 'rg'), '')
        writeFileSync(join(unpackedDir, UNPACKED_PLATFORM_MARKER), 'arm64-darwin')

        const { resolveBinaryPath } = await getFreshModule()
        expect(resolveBinaryPath('rg')).toBe(join(unpackedDir, 'rg'))
    })

    it('有 unpacked 二进制但无平台标记时回退到系统 PATH', async () => {
        mkdirSync(unpackedDir, { recursive: true })
        writeFileSync(join(unpackedDir, 'rg'), '')
        // 不写标记文件

        const { resolveBinaryPath } = await getFreshModule()
        expect(resolveBinaryPath('rg')).toBe('rg')
    })

    it('结果被缓存，多次调用返回同一引用', async () => {
        mkdirSync(unpackedDir, { recursive: true })
        writeFileSync(join(unpackedDir, 'rg'), '')
        writeFileSync(join(unpackedDir, UNPACKED_PLATFORM_MARKER), 'arm64-darwin')

        const { resolveBinaryPath } = await getFreshModule()
        const first = resolveBinaryPath('rg')
        const second = resolveBinaryPath('rg')
        expect(first).toBe(second)
    })
})
