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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchLatestRelease, fetchReleases, filterByChannel, type GitHubRelease } from '@/upgrader/checker'

// mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const mockReleases: GitHubRelease[] = [
    { tag_name: 'v0.3.0-rc.2', published_at: '2026-06-01T10:00:00Z', assets: [], prerelease: false },
    { tag_name: 'v0.3.0-rc.1', published_at: '2026-05-28T10:00:00Z', assets: [], prerelease: false },
    { tag_name: 'v0.2.0', published_at: '2026-05-20T10:00:00Z', assets: [], prerelease: false },
    { tag_name: 'v0.1.0', published_at: '2026-05-10T10:00:00Z', assets: [], prerelease: false },
]

describe('filterByChannel', () => {
    it('filters stable releases', () => {
        const result = filterByChannel(mockReleases, 'stable')
        expect(result.map(r => r.tag_name)).toEqual(['v0.2.0', 'v0.1.0'])
    })

    it('filters rc releases', () => {
        const result = filterByChannel(mockReleases, 'rc')
        expect(result.map(r => r.tag_name)).toEqual(['v0.3.0-rc.2', 'v0.3.0-rc.1'])
    })

    it('returns all when channel is undefined', () => {
        const result = filterByChannel(mockReleases)
        expect(result).toHaveLength(4)
    })
})

describe('fetchLatestRelease', () => {
    beforeEach(() => {
        mockFetch.mockReset()
    })

    it('returns latest stable release', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockReleases,
        })

        const result = await fetchLatestRelease('stable')
        expect(result?.tag_name).toBe('v0.2.0')
    })

    it('returns latest rc release', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockReleases,
        })

        const result = await fetchLatestRelease('rc')
        expect(result?.tag_name).toBe('v0.3.0-rc.2')
    })

    it('returns null when no matching release', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => [],
        })

        const result = await fetchLatestRelease('stable')
        expect(result).toBeNull()
    })

    it('throws on network error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'))

        await expect(fetchLatestRelease('stable')).rejects.toThrow('Network error')
    })
})

describe('fetchReleases', () => {
    beforeEach(() => {
        mockFetch.mockReset()
    })

    it('fetches and filters releases by channel', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockReleases,
        })

        const result = await fetchReleases({ channel: 'rc', limit: 5 })
        expect(result).toHaveLength(2)
        expect(result[0].tag_name).toBe('v0.3.0-rc.2')
    })

    it('fetches all channels when no filter', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockReleases,
        })

        const result = await fetchReleases({ limit: 10 })
        expect(result).toHaveLength(4)
    })

    it('respects limit', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockReleases,
        })

        const result = await fetchReleases({ channel: 'stable', limit: 1 })
        expect(result).toHaveLength(1)
    })
})
