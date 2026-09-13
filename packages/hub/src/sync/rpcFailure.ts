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
 * RPC 传输故障的**分类**——Hub → CLI 与 Hub → machine 两条 RPC 通道共用。
 *
 * 这个模块只装「分类」这一个概念，不含任何判据：**分类由产生故障的那一层定下**
 * （适配器见 rpcGateway 的 `rpcCall` / `spawnSession`），消费方（领域层）只读，
 * 不再拿 `message.includes(...)` 反解故障性质。此前判据在领域层，适配器或另一个
 * 进程改一个字，分类就静默退化成 `other`——把内部措辞当人话透给 agent。
 *
 * 值域刻意是封闭的**三类**：
 * - `unreachable`：这条 RPC 通道根本不存在（handler 没登记 / socket 断了）
 * - `timeout`：发出去了，没在预算内回执——**不代表没送到**，消费方要按「可能已送达」说
 * - `other`：其余。它的 message 已是给人看的句子，消费方原样透出
 *
 * 上游来的失败是**开放集合**，一律落 `other` + 自由文本，不逼着给无穷的上游失败
 * 编无穷的码（与 `AgentOpFailureReason` 画的同一条边界：自己产生的封闭集合才码化）。
 */

/** 传输故障的分类值。文案可改，分类值稳定，程序分支只认它。 */
export type RpcFailureKind = 'unreachable' | 'timeout' | 'other'

/**
 * 带分类的传输故障。
 *
 * 继承 Error 是必要的：既有链路里有大量 `error instanceof Error ? error.message : String(error)`
 * 的兜底，不作 Error 抛会被那些地方说成 `[object Object]`。
 */
export class RpcFailure extends Error {
    constructor(
        readonly kind: RpcFailureKind,
        message: string,
    ) {
        super(message)
        this.name = 'RpcFailure'
    }
}

/**
 * 从任意异常读出「分类 + 文案」。
 *
 * **不是 `RpcFailure` 的一律读成 `other`**：分类只有在产生故障的那一层才拿得到，
 * 拿不到就是拿不到——此时把原始句子原样透出去，比在消费方再猜一遍诚实得多。
 * 这也正是本模块要立的规矩：hub 自己抛的错不该被当成跨进程散文去猜。
 */
export function readRpcFailure(error: unknown): { kind: RpcFailureKind; message: string } {
    if (error instanceof RpcFailure) {
        return { kind: error.kind, message: error.message }
    }
    return { kind: 'other', message: error instanceof Error ? error.message : String(error) }
}
