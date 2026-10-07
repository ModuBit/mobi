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
 * 深化候选④票①签名迁移适配：既有行为锁测试仍以旧扁平 opts 构造（字段与断言直接对应），
 * 此 helper 就地拆成 claudeRemote(round, source, events) 三分组。新测试（attach 编舞等）
 * 直接用三分组构造，不经此适配。
 */

/** StreamSnapshotSender 无操作替身：旧扁平 opts 测试与 attach 编舞测试共用
 *  （sender 构造已收进 SessionStreamRuntime，测试不再有真 converter 可喂） */
export function stubSnapshotSender(): Record<string, unknown> {
    const noop = () => {}
    return {
        start: noop, destroy: noop, forceFullFlush: noop, flush: noop, clearBuffers: noop,
        setSnapshotOpts: noop, startBlock: noop, append: noop, endBlock: noop,
        currentStreamLocalId: () => null, markFullDelivered: noop, consumePendingFull: () => null,
        injectThinkingMeta: noop,
    }
}

/** 旧扁平 opts 的 rewind 四件套 → RemoteRewindPlan 子对象（resumeSessionAt 缺省 = 非截断轮） */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function splitRemoteArgs(flat: Record<string, any>): any[] {
    const {
        resumeSessionAt, resumeDropsTurn, onRewindTruncated, onRewindRefusal,
        nextMessage, onCollectedMessageAbandoned,
        // getConverter 已被 createSnapshotSender 取代（深化候选④票③）——旧测试的
        // converter 替身仅服务 sender 构造，直接换成无操作 sender 替身
        getConverter: _getConverter,
        ...rest
    } = flat

    // onTruncated/onRefusal 原样透传（可能 undefined）：可选性是调用契约——
    // onRewindRefusal 缺省 = F3 门控语义（按普通 startup 失败向上抛，不走 recovery）
    const rewind = resumeSessionAt !== undefined ? {
        resumeAt: resumeSessionAt,
        dropsTurn: resumeDropsTurn,
        onTruncated: onRewindTruncated,
        onRefusal: onRewindRefusal,
    } : undefined

    const roundKeys = ['sessionId', 'path', 'rewind', 'outputStyle', 'forkActivation', 'mcpServers',
        'claudeEnvVars', 'claudeArgs', 'allowedTools', 'hookSettings', 'additionalDirectories',
        'getSessionConfig', 'flushConfig', 'canCallTool', 'onElicitation']
    const sourceKeys = ['nextMessage', 'onCollectedMessageAbandoned']

    const round: Record<string, any> = { rewind }
    const source: Record<string, any> = { nextMessage, onCollectedMessageAbandoned }
    const events: Record<string, any> = { createSnapshotSender: () => stubSnapshotSender() }
    for (const [k, v] of Object.entries(rest)) {
        if (roundKeys.includes(k)) round[k] = v
        else if (sourceKeys.includes(k)) source[k] = v
        else events[k] = v
    }
    return [round, source, events]
}
