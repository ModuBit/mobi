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

import { vi } from 'vitest'

/**
 * ActionLink 会话恢复守卫的 useMobiApi mock 模块（vi.mock 工厂按路径 spread 进
 * 真实 client 模块）：默认会话始终激活（不拦截）、resume no-op。
 * 需要自控激活态/恢复行为的用例（如 MarkdownActionLink 集成测试）自带 hoisted mock。
 */
export const useMobiApi = () => ({
    sessions: {
        get: vi.fn(async () => ({ data: { session: { active: true } } })),
        resume: vi.fn(async () => ({ data: { sessionId: '' } })),
    },
})
