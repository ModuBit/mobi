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
 * 宿主通道拓扑 module（架构评审候选⑤）的测试面 = 派生规则的四个分支：
 * env 覆盖 / 非法回退 / 越界 wrap / 默认锚。地址知识单源于此，
 * 端口漂移类 bug 一处修——这里的断言就是全仓库的口径。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    DEFAULT_LISTEN_PORT,
    HOST_PORT_OFFSET,
    resolveHostPort,
    hostChannelUrl,
    defaultHostChannelUrl,
} from '@/hostChannel'

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

describe('resolveHostPort', () => {
    it('合法 MOBI_HOST_PORT 优先直用（覆盖派生）', () => {
        vi.stubEnv('MOBI_HOST_PORT', '13000')
        expect(resolveHostPort(2222)).toBe(13000)
    })

    it('非法 MOBI_HOST_PORT → warn + 回退派生（fail-open）', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.stubEnv('MOBI_HOST_PORT', 'abc')
        expect(resolveHostPort(2222)).toBe(12222)
        expect(warn).toHaveBeenCalledTimes(1)
    })

    it('非法 MOBI_HOST_PORT 下 defaultHostChannelUrl 不产出坏 URL（行为统一锁：回退 12222 而非拼接原始串）', () => {
        vi.stubEnv('MOBI_HOST_PORT', 'abc')
        expect(defaultHostChannelUrl()).toBe('http://127.0.0.1:12222')
    })

    it('派生越界 wrap 回非特权段：1024 + derived % (65535-1024)', () => {
        expect(resolveHostPort(65_535)).toBe(1024 + (65_535 + HOST_PORT_OFFSET) % (65_535 - 1024))
    })

    it('默认主端口派生 12222（向后兼容锚，防默认漂移）', () => {
        expect(resolveHostPort(DEFAULT_LISTEN_PORT)).toBe(12222)
        expect(DEFAULT_LISTEN_PORT).toBe(2222)
    })
})

describe('hostChannelUrl / defaultHostChannelUrl', () => {
    it('loopback URL 构造', () => {
        expect(hostChannelUrl(12223)).toBe('http://127.0.0.1:12223')
    })

    it('开箱默认 = 默认主端口的派生 URL', () => {
        expect(defaultHostChannelUrl()).toBe('http://127.0.0.1:12222')
    })
})
