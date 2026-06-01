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

import { GITHUB_RELEASES_API, detectChannel, VERSION_LIST_LIMIT, type Channel } from './constants'

export interface GitHubRelease {
    tag_name: string
    published_at: string
    assets: GitHubReleaseAsset[]
    prerelease: boolean
}

export interface GitHubReleaseAsset {
    name: string
    browser_download_url: string
    size: number
}

/**
 * 根据 channel 过滤 releases
 */
export function filterByChannel(releases: GitHubRelease[], channel?: Channel): GitHubRelease[] {
    const filtered = channel
        ? releases.filter(r => detectChannel(r.tag_name) === channel)
        : releases.filter(r => detectChannel(r.tag_name) !== null)

    // 按发布时间降序
    return filtered.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
}

/**
 * 从 GitHub Releases API 获取最新匹配的 release
 */
export async function fetchLatestRelease(channel: Channel): Promise<GitHubRelease | null> {
    const response = await fetch(GITHUB_RELEASES_API, {
        headers: { 'Accept': 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`)
    }

    const releases = await response.json() as GitHubRelease[]
    const filtered = filterByChannel(releases, channel)
    return filtered[0] ?? null
}

/**
 * 根据 tag 获取特定 release
 */
export async function fetchReleaseByTag(tag: string): Promise<GitHubRelease | null> {
    const response = await fetch(`${GITHUB_RELEASES_API}/tags/${tag}`, {
        headers: { 'Accept': 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15_000),
    })

    if (response.status === 404) return null
    if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`)
    }

    return await response.json() as GitHubRelease
}

/**
 * 获取版本列表
 */
export async function fetchReleases(options?: { channel?: Channel; limit?: number }): Promise<GitHubRelease[]> {
    const limit = options?.limit ?? VERSION_LIST_LIMIT
    const response = await fetch(GITHUB_RELEASES_API, {
        headers: { 'Accept': 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`)
    }

    const releases = await response.json() as GitHubRelease[]
    return filterByChannel(releases, options?.channel).slice(0, limit)
}

/**
 * 比较版本号，判断 target 是否比 current 新
 */
export function isNewerVersion(current: string, target: string): boolean {
    // 去掉 v 前缀
    const parseVersion = (v: string) => v.replace(/^v/, '').split(/[-.]/).map(Number)
    const cur = parseVersion(current)
    const tgt = parseVersion(target)

    for (let i = 0; i < Math.max(cur.length, tgt.length); i++) {
        const a = cur[i] ?? 0
        const b = tgt[i] ?? 0
        if (b > a) return true
        if (b < a) return false
    }

    return false
}
