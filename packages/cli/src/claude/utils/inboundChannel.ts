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

import type { PromptPayload } from '@/utils/promptBuilder'

/**
 * 本会话入站通道的写端——同时管着「本轮 sink 的生死」与「对 Hub 的上报」。
 *
 * **为什么要它**：这两件事必须同步翻转，而它们原先在 launcher 里相隔 87 行人工配对
 * （装 sink 的那处报 true、finally 里的另一处报 false，还有第三处在别处读 sink）。
 * 配对靠人记住「改一处要改另一处」，漏改是静默的：Hub 那边只会一直等，或一直把话说错。
 *
 * **只在翻转时上报**（Hub 侧 SessionReceiveReadiness 的接口就写着这条），于是
 * `down()` 在**本轮从没接通过**时不报——query 都没起来就进 finally 的那种轮次，
 * 真相是「还没有过上报」，不是「连接没了」。报 false 会让 Hub 说出「它曾经连上过、
 * 连接没了」这句写端无从知道的话（Hub 侧 unreachableDeliveryMessage 按这个值分两种说法）。
 *
 * 它是**此刻**的事实而非稳定属性：每轮收尾断开、下一轮再接上，所以它会反复翻转。
 * 事实不落盘、也不跨进程——它随会话进程生灭。
 */

/** 本轮的入站 sink：返回是否被接纳（stream 已关则为 false） */
export type InboundSink = (payload: PromptPayload) => boolean

export class InboundChannel {
    private sink: InboundSink | null = null
    /** 上一次上报出去的值。它是「这个值是否成立」的记忆，也是 down 时该不该开口的判据 */
    private up = false

    /** report 是唯一出口。构造时注入而不直接依赖 ApiSessionClient：本类的全部行为
     *  （翻转与否）都能由一个 spy 看完，不必起会话 */
    constructor(private readonly report: (canReceive: boolean) => void) {}

    /** 本轮的 sink；没接上、或已断开都是 null。**每次都重新取**，不要缓存到长命变量里 */
    current(): InboundSink | null {
        return this.sink
    }

    /** 本轮通道接通（claudeRemote 起 input stream 时注入 sink）：装 sink + 上报「能收」 */
    ready(sink: InboundSink): void {
        this.sink = sink
        this.flip(true)
    }

    /** 本轮通道关闭（launch 收尾）：清 sink + 上报「不能收」 */
    down(): void {
        this.sink = null
        this.flip(false)
    }

    private flip(next: boolean): void {
        if (this.up === next) return
        this.up = next
        this.report(next)
    }
}
