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

import { describe, it, expect } from 'vitest'
import { resolveSubmitButtonState } from '@/components/composer/submitButtonState'

describe('resolveSubmitButtonState', () => {
    it('空闲且有内容 → 发送（可用）', () => {
        expect(resolveSubmitButtonState({
            canSend: true, running: false, sending: false, abortPending: false,
        })).toEqual({ kind: 'send', disabled: false })
    })

    it('空闲且无内容 → 发送（禁用）', () => {
        expect(resolveSubmitButtonState({
            canSend: false, running: false, sending: false, abortPending: false,
        })).toEqual({ kind: 'send', disabled: true })
    })

    it('running 且无内容 → 停止', () => {
        expect(resolveSubmitButtonState({
            canSend: false, running: true, sending: false, abortPending: false,
        })).toEqual({ kind: 'stop', disabled: false, loading: false })
    })

    it('running 且有内容（特殊情况）→ 仍展示发送', () => {
        // canSend 优先于 running：running 中只要有可发送内容就走发送分支
        expect(resolveSubmitButtonState({
            canSend: true, running: true, sending: false, abortPending: false,
        })).toEqual({ kind: 'send', disabled: false })
    })

    it('sending 过渡态且无内容 → 停止（覆盖 mutation 已发、running 未翻 true 的窗口）', () => {
        expect(resolveSubmitButtonState({
            canSend: false, running: false, sending: true, abortPending: false,
        })).toEqual({ kind: 'stop', disabled: false, loading: false })
    })

    it('请求权限期间（canSend=false + running）→ 停止且可用', () => {
        // 输入框由 Sender disabled 锁住，唯独停止按钮亮着
        expect(resolveSubmitButtonState({
            canSend: false, running: true, sending: false, abortPending: false,
        })).toEqual({ kind: 'stop', disabled: false, loading: false })
    })

    it('abortPending → 停止按钮禁用并转圈', () => {
        expect(resolveSubmitButtonState({
            canSend: false, running: true, sending: false, abortPending: true,
        })).toEqual({ kind: 'stop', disabled: true, loading: true })
    })

    it('canSend 优先于 abortPending：有内容时即便 abortPending 仍展示发送', () => {
        expect(resolveSubmitButtonState({
            canSend: true, running: true, sending: false, abortPending: true,
        })).toEqual({ kind: 'send', disabled: false })
    })
})
