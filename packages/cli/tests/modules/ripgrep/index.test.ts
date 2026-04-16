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
 * Tests for low-level ripgrep wrapper
 */

import { describe, it, expect } from 'vitest'
import { run } from '@/modules/ripgrep'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { platform } from 'os'
import { runtimePath } from '@/projectPath'

// 检查 ripgrep 二进制文件是否存在
function isRipgrepAvailable(): boolean {
    const binaryName = platform() === 'win32' ? 'rg.exe' : 'rg'
    const binaryPath = resolve(join(runtimePath(), 'tools', 'unpacked', binaryName))
    return existsSync(binaryPath)
}

const describeIfAvailable = describe.skipIf(!isRipgrepAvailable())

describeIfAvailable('ripgrep low-level wrapper', () => {
    it('should get version', async () => {
        const result = await run(['--version'])
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('ripgrep')
    })
    
    it('should search for pattern', async () => {
        const result = await run(['describe', 'src/modules/ripgrep/index.test.ts'])
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('describe')
    })
    
    it('should return exit code 1 for no matches', async () => {
        const result = await run(['ThisPatternShouldNeverMatch999', 'package.json'])
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toBe('')
    })
    
    it('should handle JSON output', async () => {
        const result = await run(['--json', 'describe', 'src/modules/ripgrep/index.test.ts'])
        expect(result.exitCode).toBe(0)
        
        // Parse first line to check it's valid JSON
        const lines = result.stdout.trim().split('\n')
        const firstLine = JSON.parse(lines[0])
        expect(firstLine).toHaveProperty('type')
    })
    
    it('should respect custom working directory', async () => {
        const result = await run(['describe', 'index.test.ts'], { cwd: 'src/modules/ripgrep' })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('describe')
    })
})