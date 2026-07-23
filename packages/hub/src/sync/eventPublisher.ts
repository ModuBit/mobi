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

import { hubLogger } from '../logger'
import type { SyncEvent } from '@mobi/shared/types'
import type { SSEManager } from '../sse/sseManager'

export type SyncEventListener = (event: SyncEvent) => void

export class EventPublisher {
    private readonly listeners: Set<SyncEventListener> = new Set()

    constructor(
        private readonly sseManager: SSEManager,
        private readonly resolveNamespace: (event: SyncEvent) => string | undefined
    ) {
    }

    subscribe(listener: SyncEventListener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    emit(event: SyncEvent): void {
        const namespace = this.resolveNamespace(event)
        const enrichedEvent = namespace ? { ...event, namespace } : event

        for (const listener of this.listeners) {
            try {
                listener(enrichedEvent)
            } catch (error) {
                hubLogger.error('[SyncEngine] Listener error:', error)
            }
        }

        this.sseManager.broadcast(enrichedEvent)
    }
}
