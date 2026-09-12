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
 * 「这个会话此刻能不能收消息」的事实 + 等它成立的原语。
 *
 * **为什么要它**：新建的会话从 spawn 回执到「真的能收消息」之间隔着 130–550ms（实测见
 * spec D40）——回执那一刻只有「进程上线了」，会话的输入通道（sink）还没接上。所以
 * 「建完即可用」不能靠回执这句话，得有个地方能等到那个时刻。
 *
 * **为什么判据是 sink 而不是别的**：`active`（进程在不在）在回执那一刻已经为真，正是假象的
 * 来源；`running`（这一轮在不在干活）是另一个语义，翻转点也不在 sink 接通处。sink 是消息的
 * 唯一入口，它通了才算真能收。
 *
 * ⚠️ **这是「此刻」的事实，不是稳定属性。** sink 在每轮收尾被清空、下一轮再接上，所以
 * 聊过一轮的会话在轮次间隙会短暂「不能收」。因此**不要拿它当闸门**（会把健康会话的投递挡在
 * 门外，而那个窗口只有几十毫秒）——它的正当用途是「等」（见 waitUntilCanReceive）与
 * 「把失败解释准」（还没接上 vs 已经退出）。
 *
 * 事实**不落库**：它随会话进程生灭，跨进程重启没有意义。所以这里只用内存，不进 Session 实体。
 */

/** 等待的结果。`unavailable` 是**确定的否定**（不是还没好），调用方该据此给不同的说法 */
export type ReceiveReadiness = 'ready' | 'unavailable' | 'timeout'

export class SessionReceiveReadiness {
    /** 事实：会话 id → 此刻能不能收。**没有条目 = 还没收到过上报**（新会话接通前就是这样） */
    private readonly canReceive = new Map<string, boolean>()
    /** 等待者：会话 id → 叫醒函数集合 */
    private readonly waiters = new Map<string, Set<() => void>>()

    /**
     * 上报入口（CLI 在 sink 接通/断开时各报一次，**状态翻转才报**）。
     *
     * 同步、不 await —— 这是下面 waitUntilCanReceive 里「查事实 + 挂等待」之间插不进东西的
     * 前提：单线程下同步代码不会被打断。
     */
    set(sessionId: string, canReceive: boolean): void {
        this.canReceive.set(sessionId, canReceive)

        const waiting = this.waiters.get(sessionId)
        if (!waiting) {
            return
        }
        // 先摘名单再叫醒：叫醒是同步调用，摘干净了才不会有人被叫两次
        this.waiters.delete(sessionId)
        for (const wake of waiting) {
            wake()
        }
    }

    /** 此刻能不能收。`undefined` = 还没有过上报 */
    get(sessionId: string): boolean | undefined {
        return this.canReceive.get(sessionId)
    }

    /**
     * 会话进程结束（CLI 正常收尾上报 session-end、或 hub 归档）时把这条事实抹掉，回到
     * 「还没上报过」。
     *
     * **抹掉，而不是留一个 false**：留 false 会让下一次询问立刻拿到「不能收」这个**确定的
     * 结论**；而进程重启后、sink 接通前的真相应是「还没接上、没有定论」。把没定论说成确定
     * 结论，正是这套事实要消灭的那类谎（`unavailable` 与 `timeout` 的差别就在这）。
     *
     * 遗留：CLI 被强杀时不会走到这里（没有 session-end 上报），旧值会留到下一次上报才被覆盖。
     * 那个窗口在子秒级，故消费方只该把它当提示，别当闸门（见文件头 ⚠️）。
     */
    clear(sessionId: string): void {
        this.canReceive.delete(sessionId)
    }

    /**
     * 等到这个会话能收消息，或等出定论。
     *
     * **等的是事实，不是事件**——这是「事件早到就不会丢」的全部理由：事实已成立时，
     * 后到的调用在第 ① 步就直接返回了（若是「等下一次翻转通知」，先到的那个通知就永远
     * 找不回来了）。三步的顺序不能反：
     *
     * ① 先**同步**读事实——已定论立即返回，一个等待者都不挂
     * ② 未定论才挂叫醒器，且必须与 ① 同处一个同步块（中间不能有 `await`）。JS 单线程、
     *    同步代码不会被打断，所以这中间插不进翻转——**这就是这里不需要锁的原因**
     * ③ 醒来后**再读一次**——被叫醒不等于成立（也可能是翻成了不能收）
     *
     * 两个配套，缺了就会变成「等不醒」或泄漏：
     * - 超时要摘掉自己（否则每次超时留一个再也叫不醒的回调）
     * - 翻成「不能收」也要叫醒（那是确定的否定答案，不该让人陪着等满超时）
     */
    async waitUntilCanReceive(sessionId: string, timeoutMs: number): Promise<ReceiveReadiness> {
        const current = this.canReceive.get(sessionId)
        if (current === true) return 'ready'
        if (current === false) return 'unavailable'

        const waiter = Promise.withResolvers<void>()
        const waiting = this.waiters.get(sessionId) ?? new Set<() => void>()
        waiting.add(waiter.resolve)
        this.waiters.set(sessionId, waiting)

        let timer: ReturnType<typeof setTimeout> | undefined
        const timedOut = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, timeoutMs)
        })

        try {
            await Promise.race([waiter.promise, timedOut])
        } finally {
            clearTimeout(timer)
            const still = this.waiters.get(sessionId)
            still?.delete(waiter.resolve)
            if (still?.size === 0) {
                this.waiters.delete(sessionId)
            }
        }

        const after = this.canReceive.get(sessionId)
        if (after === true) return 'ready'
        if (after === false) return 'unavailable'
        return 'timeout'
    }
}
