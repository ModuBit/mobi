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

import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerMachineDirectoryHandler } from '@/modules/common/handlers/machineDirectory'

async function createTempDir(prefix: string): Promise<string> {
    const base = tmpdir()
    const path = join(base, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    return path
}

describe('machine list-directory RPC handler', () => {
    let homeDir: string
    let rpc: RpcHandlerManager
    const scopePrefix = 'machine-test'

    beforeEach(async () => {
        if (homeDir) {
            await rm(homeDir, { recursive: true, force: true })
        }

        homeDir = await createTempDir('mobi-machine-dir')
        await mkdir(join(homeDir, 'projects'), { recursive: true })
        await mkdir(join(homeDir, '.config'), { recursive: true })
        await writeFile(join(homeDir, 'README.md'), '# test')

        rpc = new RpcHandlerManager({ scopePrefix })
        registerMachineDirectoryHandler(rpc)
    })

    it('仅返回目录（含隐藏目录），不含文件', async () => {
        const response = await rpc.handleRequest({
            method: `${scopePrefix}:list-directory`,
            params: JSON.stringify({ path: homeDir, homeDir })
        })

        const parsed = JSON.parse(response) as {
            success: boolean
            entries?: Array<{ name: string }>
        }
        expect(parsed.success).toBe(true)

        const names = (parsed.entries ?? []).map((e) => e.name)
        expect(names).toContain('projects')
        expect(names).toContain('.config')
        expect(names).not.toContain('README.md')
    })

    it('拒绝访问 homeDir 外的路径', async () => {
        const response = await rpc.handleRequest({
            method: `${scopePrefix}:list-directory`,
            params: JSON.stringify({ path: '/etc', homeDir })
        })

        const parsed = JSON.parse(response) as { success: boolean; error?: string }
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('outside the home directory')
    })

    it('拒绝 homeDir 为空时', async () => {
        const response = await rpc.handleRequest({
            method: `${scopePrefix}:list-directory`,
            params: JSON.stringify({ path: homeDir, homeDir: '' })
        })

        const parsed = JSON.parse(response) as { success: boolean; error?: string }
        expect(parsed.success).toBe(false)
    })
})
