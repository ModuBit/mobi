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

import { getSessionMessages, type SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/ui/logger'

/** 正向分页每页条数 */
const PAGE_SIZE = 50
/** 最大回扫页数（防病态长链死循环；50×40=2000 条 entry 覆盖常规会话） */
const MAX_PAGES = 40

/**
 * transcript 分页扫描的共享骨架（rewind 锚点换算与 fork 激活预检两个消费方，
 * 同一「offset 从头部正向跳过、旧→新返回」的分页语义——PoC poc8 实测结论）：
 * 逐页读入直到 uuid 精确命中（user 类型 entry 含 tool_result 载体，不能按计数匹配）、
 * 空页 / 末页不满（扫完）、或超过 MAX_PAGES（防病态长链）为止。
 *
 * @param onHit 命中时回调一次（scanned 为旧→新全量已扫前缀，hitIndex 为命中位置）——
 *              需要命中上下文的消费方用（如 rewind 找锚点前驱 assistant），存在性判定忽略
 * @returns 'found' | 'not-found'（读取异常不在此吞：由消费方按各自失败语义处理）
 */
export async function scanTranscriptForUuid(
    sessionId: string,
    dir: string,
    uuid: string,
    onHit?: (scanned: SessionMessage[], hitIndex: number) => void,
): Promise<'found' | 'not-found'> {
    const scanned: SessionMessage[] = []

    for (let page = 0; page < MAX_PAGES; page++) {
        const messages = await getSessionMessages(sessionId, { dir, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
        if (messages.length === 0) {
            logger.debug(`[transcriptScan] exhausted transcript without hitting ${uuid} (page=${page})`)
            return 'not-found'
        }
        scanned.push(...messages)

        const idx = scanned.findIndex(m => m.uuid === uuid)
        if (idx >= 0) {
            onHit?.(scanned, idx)
            return 'found'
        }

        if (messages.length < PAGE_SIZE) {
            logger.debug(`[transcriptScan] reached transcript end without hitting ${uuid}`)
            return 'not-found'
        }
    }

    // 超出回扫上限仍未命中：按未命中处理（防病态长链）
    logger.warn(`[transcriptScan] exceeded MAX_PAGES (${MAX_PAGES}) without hitting ${uuid}`)
    return 'not-found'
}
