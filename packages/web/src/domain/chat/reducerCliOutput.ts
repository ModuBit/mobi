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

import type { ChatBlock, CliOutputBlock, MessageMeta } from './types'

const CLI_TAG_REGEX = /<(?:local-command-[a-z-]+|command-(?:name|message|args))>/i
const CLI_COMMAND_NAME_REGEX = /<command-name>/i
const CLI_COMMAND_STDOUT_REGEX = /<local-command-stdout>/i
const LOCAL_COMMAND_STDOUT_EXTRACT = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/i

function getMetaSentFrom(meta: unknown): string | null {
    if (!meta || typeof meta !== 'object') return null
    const sentFrom = (meta as { sentFrom?: unknown }).sentFrom
    return typeof sentFrom === 'string' ? sentFrom : null
}

function hasCliOutputTags(text: string): boolean {
    return CLI_TAG_REGEX.test(text)
}

function hasCommandNameTag(text: string): boolean {
    return CLI_COMMAND_NAME_REGEX.test(text)
}

function hasLocalCommandStdoutTag(text: string): boolean {
    return CLI_COMMAND_STDOUT_REGEX.test(text)
}

export function isCliOutputText(text: string, meta?: unknown): boolean {
    return hasCliOutputTags(text)
}

/** 提取纯 local-command-stdout 内容（无 command-name），返回文本或 null */
export function extractStandaloneStdout(text: string): string | null {
    if (!hasLocalCommandStdoutTag(text) || hasCommandNameTag(text)) {
        return null
    }
    const match = text.match(LOCAL_COMMAND_STDOUT_EXTRACT)
    return match ? match[1].replace(/&#x[0-9A-Fa-f]+;/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    ).replace(/\x1B\[[0-9;]*m/g, '').trim() : null
}

export function createCliOutputBlock(props: {
    id: string
    localId: string | null
    createdAt: number
    text: string
    source: CliOutputBlock['source']
    meta?: MessageMeta
}): CliOutputBlock {
    return {
        kind: 'cli-output',
        id: props.id,
        localId: props.localId,
        createdAt: props.createdAt,
        text: props.text,
        source: props.source,
        meta: props.meta
    }
}

export function mergeCliOutputBlocks(blocks: ChatBlock[]): ChatBlock[] {
    const merged: ChatBlock[] = []

    for (const block of blocks) {
        if (block.kind !== 'cli-output') {
            merged.push(block)
            continue
        }

        const prev = merged[merged.length - 1]
        if (
            prev
            && prev.kind === 'cli-output'
            && prev.source === block.source
            // command-name + local-command-stdout 合并
            && hasCommandNameTag(prev.text) && !hasLocalCommandStdoutTag(prev.text) && hasLocalCommandStdoutTag(block.text)
        ) {
            const separator = prev.text.endsWith('\n') || block.text.startsWith('\n') ? '' : '\n'
            merged[merged.length - 1] = { ...prev, text: `${prev.text}${separator}${block.text}` }
            continue
        }

        merged.push(block)
    }

    return merged
}
