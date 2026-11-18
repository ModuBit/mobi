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
 * `mobi` 默认帮助的对外契约（tui-fork 票 03）：
 * 引导 fork / Web / daemon；内部 spawn 入口不出现在帮助里。
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_HELP_TEXT } from '@/commands/defaultHelp'

describe('DEFAULT_HELP_TEXT', () => {
    it('引导 mobi fork 与 daemon 启动', () => {
        expect(DEFAULT_HELP_TEXT).toContain('mobi fork')
        expect(DEFAULT_HELP_TEXT).toContain('mobi daemon start')
    })

    it('不再宣传终端隐式创建会话，也不暴露内部 claude 入口', () => {
        expect(DEFAULT_HELP_TEXT).not.toContain('mobi claude')
        expect(DEFAULT_HELP_TEXT).not.toContain('Start Claude with remote control')
        expect(DEFAULT_HELP_TEXT).not.toContain('Start a Claude session')
    })
})
