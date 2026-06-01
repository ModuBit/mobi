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
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { downloadBinary, verifyChecksum, extractBinaryFromZip, type GitHubReleaseAsset } from '@/upgrader/downloader'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const tmpDir = join(tmpdir(), `mobi-test-downloader-${process.pid}`)

beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
    mockFetch.mockReset()
})

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
})

describe('verifyChecksum', () => {
    it('verifies correct SHA256', () => {
        const content = 'hello mobi'
        const hash = createHash('sha256').update(content).digest('hex')
        const filePath = join(tmpDir, 'test.bin')
        writeFileSync(filePath, content)

        const checksums = `aabbccdd  other-file\n${hash}  mobi-darwin-arm64.zip`
        expect(verifyChecksum(filePath, 'mobi-darwin-arm64.zip', checksums)).toBe(true)
    })

    it('rejects incorrect SHA256', () => {
        const filePath = join(tmpDir, 'test.bin')
        writeFileSync(filePath, 'hello mobi')

        const checksums = `00000000  mobi-darwin-arm64.zip`
        expect(verifyChecksum(filePath, 'mobi-darwin-arm64.zip', checksums)).toBe(false)
    })

    it('rejects when asset name not found in checksums', () => {
        const filePath = join(tmpDir, 'test.bin')
        writeFileSync(filePath, 'hello mobi')

        const checksums = `aabbccdd  other-file.zip`
        expect(verifyChecksum(filePath, 'mobi-darwin-arm64.zip', checksums)).toBe(false)
    })
})

describe('downloadBinary', () => {
    it('downloads and returns file path', async () => {
        const asset: GitHubReleaseAsset = {
            name: 'mobi-darwin-arm64.zip',
            browser_download_url: 'https://example.com/mobi-darwin-arm64.zip',
            size: 100,
        }

        mockFetch.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () => new TextEncoder().encode('binary-content').buffer,
        })

        const result = await downloadBinary(asset, tmpDir)
        expect(result).toContain('mobi-darwin-arm64.zip')
    })

    it('throws on download failure', async () => {
        const asset: GitHubReleaseAsset = {
            name: 'mobi-darwin-arm64.zip',
            browser_download_url: 'https://example.com/mobi-darwin-arm64.zip',
            size: 100,
        }

        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        })

        await expect(downloadBinary(asset, tmpDir)).rejects.toThrow('Failed to download')
    })
})

describe('extractBinaryFromZip', () => {
    it('extracts binary from zip archive', () => {
        const zipPath = join(tmpDir, 'test-archive.zip')
        const binaryContent = 'fake-mobi-binary'

        writeFileSync(join(tmpDir, 'mobi'), binaryContent)
        execFileSync('zip', [zipPath, 'mobi'], { cwd: tmpDir, stdio: 'pipe' })

        const result = extractBinaryFromZip(zipPath)
        expect(result).toContain('mobi')
        expect(result).toContain('extracted')
        expect(readFileSync(result, 'utf-8')).toBe(binaryContent)
    })

    it('throws when binary not found in archive', () => {
        const zipPath = join(tmpDir, 'empty-archive.zip')
        writeFileSync(join(tmpDir, 'dummy.txt'), 'not-mobi')
        execFileSync('zip', [zipPath, 'dummy.txt'], { cwd: tmpDir, stdio: 'pipe' })

        expect(() => extractBinaryFromZip(zipPath)).toThrow('Binary not found in archive')
    })
})
