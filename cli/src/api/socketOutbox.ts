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

import { logger } from '@/ui/logger'

const DEFAULT_OUTBOX_MAX_BYTES = resolveEnvNumber('MOBI_OUTBOX_MAX_BYTES', 16_000_000)
const DEFAULT_OUTBOX_MAX_ITEMS = resolveEnvNumber('MOBI_OUTBOX_MAX_ITEMS', 500)
const DEFAULT_OUTBOX_MAX_ITEM_BYTES = resolveEnvNumber('MOBI_OUTBOX_MAX_ITEM_BYTES', 1_000_000)
const DEFAULT_OUTBOX_MAX_AGE_MS = resolveEnvNumber('MOBI_OUTBOX_MAX_AGE_MS', 15 * 60_000, true)
const DEFAULT_DROP_LOG_INTERVAL_MS = resolveEnvNumber('MOBI_OUTBOX_DROP_LOG_INTERVAL_MS', 5_000)

type OutboxItem = {
    event: string
    args: readonly unknown[]
    sizeBytes: number
    enqueuedAt: number
}

type SocketOutboxOptions = {
    maxBytes?: number
    maxItems?: number
    maxItemBytes?: number
    maxAgeMs?: number
    dropLogIntervalMs?: number
}

function resolveEnvNumber(name: string, fallback: number, allowZero: boolean = false): number {
    const raw = process.env[name]
    if (!raw) {
        return fallback
    }
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) {
        return fallback
    }
    if (parsed < 0) {
        return fallback
    }
    if (parsed === 0 && !allowZero) {
        return fallback
    }
    return parsed
}

function estimateSizeBytes(payload: unknown): number {
    try {
        return Buffer.byteLength(JSON.stringify(payload), 'utf8')
    } catch {
        return Number.MAX_SAFE_INTEGER
    }
}

export class SocketOutbox {
    private readonly maxBytes: number
    private readonly maxItems: number
    private readonly maxItemBytes: number
    private readonly maxAgeMs: number
    private readonly dropLogIntervalMs: number
    private items: OutboxItem[] = []
    private queuedBytes = 0
    private droppedCount = 0
    private droppedBytes = 0
    private lastDropLogAt = 0
    private lastDropReason = 'unknown'

    constructor(options?: SocketOutboxOptions) {
        this.maxBytes = options?.maxBytes ?? DEFAULT_OUTBOX_MAX_BYTES
        this.maxItems = options?.maxItems ?? DEFAULT_OUTBOX_MAX_ITEMS
        this.maxItemBytes = options?.maxItemBytes ?? DEFAULT_OUTBOX_MAX_ITEM_BYTES
        this.maxAgeMs = options?.maxAgeMs ?? DEFAULT_OUTBOX_MAX_AGE_MS
        this.dropLogIntervalMs = options?.dropLogIntervalMs ?? DEFAULT_DROP_LOG_INTERVAL_MS
    }

    enqueue(event: string, args: readonly unknown[]): boolean {
        if (this.maxBytes <= 0 || this.maxItems <= 0) {
            this.recordDrop('outbox-disabled', 0)
            return false
        }

        this.dropExpired()

        const sizeBytes = estimateSizeBytes({ event, args })
        if (sizeBytes > this.maxItemBytes || sizeBytes > this.maxBytes) {
            this.recordDrop('item-too-large', sizeBytes)
            return false
        }

        while (this.items.length >= this.maxItems || this.queuedBytes + sizeBytes > this.maxBytes) {
            const removed = this.items.shift()
            if (!removed) {
                break
            }
            this.queuedBytes -= removed.sizeBytes
            this.recordDrop('outbox-full', removed.sizeBytes)
        }

        if (this.items.length >= this.maxItems || this.queuedBytes + sizeBytes > this.maxBytes) {
            this.recordDrop('outbox-full', sizeBytes)
            return false
        }

        this.items.push({
            event,
            args,
            sizeBytes,
            enqueuedAt: Date.now()
        })
        this.queuedBytes += sizeBytes
        return true
    }

    flush(emit: (event: string, args: readonly unknown[]) => void): void {
        this.dropExpired()

        if (this.items.length === 0) {
            return
        }

        const items = this.items
        this.items = []
        this.queuedBytes = 0

        for (const item of items) {
            emit(item.event, item.args)
        }
    }

    private dropExpired(): void {
        if (this.maxAgeMs <= 0) {
            return
        }

        const cutoff = Date.now() - this.maxAgeMs
        while (this.items.length > 0 && this.items[0].enqueuedAt < cutoff) {
            const removed = this.items.shift()
            if (!removed) {
                break
            }
            this.queuedBytes -= removed.sizeBytes
            this.recordDrop('expired', removed.sizeBytes)
        }
    }

    private recordDrop(reason: string, bytes: number): void {
        this.droppedCount += 1
        this.droppedBytes += bytes
        this.lastDropReason = reason

        const now = Date.now()
        if (now - this.lastDropLogAt < this.dropLogIntervalMs) {
            return
        }

        logger.warn(`[OUTBOX] Dropped ${this.droppedCount} items (${this.droppedBytes} bytes). reason=${this.lastDropReason}`)
        this.droppedCount = 0
        this.droppedBytes = 0
        this.lastDropLogAt = now
    }
}
