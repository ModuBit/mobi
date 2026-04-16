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
 * Tests for difftastic module
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { run } from '@/modules/difftastic';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir, platform } from 'os';
import { runtimePath } from '@/projectPath';

// 检查 difftastic 二进制文件是否存在
function isDifftasticAvailable(): boolean {
    const binaryName = platform() === 'win32' ? 'difft.exe' : 'difft';
    const binaryPath = resolve(join(runtimePath(), 'tools', 'unpacked', binaryName));
    return existsSync(binaryPath);
}

const describeIfAvailable = describe.skipIf(!isDifftasticAvailable());

describeIfAvailable('difftastic', () => {
    let testDir: string;
    let file1Path: string;
    let file2Path: string;

    beforeAll(() => {
        // Create test directory and files
        testDir = join(tmpdir(), `difftastic-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });

        file1Path = join(testDir, 'file1.txt');
        file2Path = join(testDir, 'file2.txt');

        writeFileSync(file1Path, 'Hello\nWorld\nTest\n');
        writeFileSync(file2Path, 'Hello\nModified\nTest\n');

        return () => {
            // Cleanup
            rmSync(testDir, { recursive: true, force: true });
        };
    });

    it('should show version', async () => {
        const result = await run(['--version']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Difftastic');
    });

    it('should compare two files', async () => {
        const result = await run([file1Path, file2Path]);
        // Difftastic returns 0 even when files differ (unlike traditional diff)
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('file2.txt');
        expect(result.stdout).toContain('World');
        expect(result.stdout).toContain('Modified');
    });

    it('should respect color option', async () => {
        const result = await run(['--color', 'never', file1Path, file2Path]);
        expect(result.exitCode).toBe(0);
        // Check that ANSI color codes are not present
        expect(result.stdout).not.toContain('\x1b[');
    });

    it('should list languages', async () => {
        const result = await run(['--list-languages']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('JavaScript');
        expect(result.stdout).toContain('TypeScript');
        expect(result.stdout).toContain('Python');
    });

    it('should handle missing files', async () => {
        const result = await run(['nonexistent.txt', 'alsonothere.txt']);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toBeTruthy();
    });
});