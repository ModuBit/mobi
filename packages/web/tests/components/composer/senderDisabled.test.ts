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
 * resolveSenderDisabled 契约：DOM disabled 只承载覆盖层形态（可见性闸）。
 *
 * 瞬态提交闸（发送 pending / 权限审批 / rewind / 压缩）**不得**进入 Sender 的
 * DOM disabled——翻转瞬间会没收聚焦中的 textarea（Android 键盘不跟收 →
 * 「键盘在、无光标、无法输入」僵局），它们归 canSend / 提交钮状态机。
 * 该约束的完整理由见 senderDisabled.ts 顶部 doc；本测试锚定「只有覆盖层两路生效」，
 * 防止未来把瞬态闸加回调用点时无契约可撞。
 */

import { describe, it, expect } from 'vitest'
import { resolveSenderDisabled } from '@/features/composer/senderDisabled'

describe('resolveSenderDisabled', () => {
    it('覆盖层任一在场即禁用（失活 cover / 本地模式 cover）', () => {
        expect(resolveSenderDisabled({ inactiveCover: true, localModeCover: false })).toBe(true)
        expect(resolveSenderDisabled({ inactiveCover: false, localModeCover: true })).toBe(true)
        expect(resolveSenderDisabled({ inactiveCover: true, localModeCover: true })).toBe(true)
    })

    it('两覆盖层都不在场即不禁用——瞬态（发送/审批/rewind）不在此函数的输入面', () => {
        expect(resolveSenderDisabled({ inactiveCover: false, localModeCover: false })).toBe(false)
    })
})
