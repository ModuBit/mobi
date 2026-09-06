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
import { applySessionIdBinding } from '@/claude/utils/sessionIdBinding'

function buildSession(sessionId: string) {
    return {
        sessionId,
        onSessionFound: vi.fn(),
    }
}

describe('applySessionIdBinding', () => {
    it('binds when session id changes', () => {
        const session = buildSession('old-id')

        applySessionIdBinding(() => session, 'new-id')

        expect(session.onSessionFound).toHaveBeenCalledTimes(1)
        expect(session.onSessionFound).toHaveBeenCalledWith('new-id')
    })

    it('is idempotent for the same session id', () => {
        const session = buildSession('same-id')

        applySessionIdBinding(() => session, 'same-id')

        expect(session.onSessionFound).not.toHaveBeenCalled()
    })

    it('is silent when session is not ready', () => {
        expect(() => applySessionIdBinding(() => null, 'any-id')).not.toThrow()
    })
})
