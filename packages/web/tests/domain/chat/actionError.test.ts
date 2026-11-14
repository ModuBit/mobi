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

// 动作失败展示文案收口的契约（原 features/chat/tool-card/actionError 迁入）：
// 网络层失败本地化 / 到达服务端的失败提取业务 detail / 非 Error 抛出值兜底。

import { describe, it, expect } from 'vitest'
import { AxiosError } from 'axios'
import { describeActionError } from '@/domain/chat/actionError'

const t = (key: string) => `t(${key})`

/** 最小 AxiosError 构造（isAxiosError 判据是实例标记） */
function axiosError(response?: { status: number; data: unknown }): AxiosError {
    const e = new AxiosError('Request failed with status code 500')
    e.isAxiosError = true
    if (response) e.response = { status: response.status, data: response.data } as AxiosError['response']
    return e
}

describe('describeActionError', () => {
    it('网络层失败（无 response）→ 本地化网络提示，不直译 "Network Error"', () => {
        const e = axiosError()
        e.message = 'Network Error'
        expect(describeActionError(e, t)).toBe('t(chat.error.title.network)')
    })

    it('带 response 的 HTTP 错误 → 提取 daemon 业务 detail，而非 axios 笼统 message', () => {
        const e = axiosError({ status: 500, data: { success: false, error: 'Access denied: protected directory' } })
        expect(describeActionError(e, t)).toBe('Access denied: protected directory')
    })

    it('带 response 但 body 无 error 字段 → 回落 Error.message 提取', () => {
        const e = axiosError({ status: 502, data: {} })
        expect(describeActionError(e, t)).toBe('Request failed with status code 500')
    })

    it('普通 Error → message 透传', () => {
        expect(describeActionError(new Error('boom'), t)).toBe('boom')
    })

    it('非 Error 抛出值 → 兜底 key（缺省通用 / 按场景定制）', () => {
        expect(describeActionError('raw string', t)).toBe('t(chat.tool.requestFailed)')
        expect(describeActionError(undefined, t, 'newSession.createFailed')).toBe('t(newSession.createFailed)')
    })
})
