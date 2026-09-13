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

import { describe, it, expect, vi } from 'vitest'
import { InboundChannel } from '@/claude/utils/inboundChannel'

function makeChannel() {
    const report = vi.fn<(canReceive: boolean) => void>()
    return { report, channel: new InboundChannel(report) }
}

const SINK = () => true

describe('InboundChannel', () => {
    it('ready 装 sink 并上报「能收」，report 只收到这一个值', () => {
        const { report, channel } = makeChannel()

        channel.ready(SINK)

        expect(channel.current()).toBe(SINK)
        expect(report.mock.calls).toEqual([[true]])
    })

    it('down 清 sink 并上报「不能收」——接通过才报，这两个动作不会各飞各的', () => {
        const { report, channel } = makeChannel()

        channel.ready(SINK)
        channel.down()

        expect(channel.current()).toBeNull()
        expect(report.mock.calls).toEqual([[true], [false]])
    })

    /**
     * 从没接通过的那一轮（query 都没起来就进 finally）不该开口：Hub 把 false 读作
     * 「曾经连上过、连接没了」，而事实是「还没有过上报」。多报一个 false 会把 Hub
     * 的一句「可能还在启动」换成一句「它可能已经退出」——写端无从知道的断言。
     */
    it('从没接通过的 down 不上报（此刻的真相是「还没有过上报」）', () => {
        const { report, channel } = makeChannel()

        channel.down()

        expect(channel.current()).toBeNull()
        expect(report).not.toHaveBeenCalled()
    })

    it('翻转才报：同一状态重复置位不重复上报（轮次之间 true/false 交替）', () => {
        const { report, channel } = makeChannel()

        channel.ready(SINK)
        channel.ready(SINK)
        channel.down()
        channel.down()
        channel.ready(SINK)

        expect(report.mock.calls).toEqual([[true], [false], [true]])
    })
})
