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
 * reducerCliOutput 单元测试
 * 核心：CLI 信封标签只在文本开头才算 CLI 输出——正文中部引用标签（如 review JSON
 * 里字面引用 <local-command-stdout>）不得误判（真实案例：/code-review 结果整条
 * 被吞成空壳 CliOutputBlock，见消息 33a657ba）
 */

import { describe, it, expect } from 'vitest'
import { isCliOutputText, extractStandaloneStdout } from '@/domain/chat/reducerCliOutput'

describe('isCliOutputText', () => {
    it('真实信封：command-name 开头 → CLI 输出', () => {
        expect(isCliOutputText('<command-name>/model</command-name>\n<command-args>opus</command-args>')).toBe(true)
    })

    it('真实信封：local-command-stdout 开头 → CLI 输出', () => {
        expect(isCliOutputText('<local-command-stdout>done</local-command-stdout>')).toBe(true)
    })

    it('前导空白后跟标签 → CLI 输出', () => {
        expect(isCliOutputText('\n  <local-command-stdout>ok</local-command-stdout>')).toBe(true)
    })

    it('正文中部引用标签（review JSON 场景）→ 普通文本', () => {
        const reviewText = '审查汇总如下。\n\n```json\n[{"summary": "正文若含 <local-command-stdout> 类标签会被 isCliOutputText 截走"}]\n```'
        expect(isCliOutputText(reviewText)).toBe(false)
    })

    it('正文中部引用 command-name 标签 → 普通文本', () => {
        expect(isCliOutputText('命令形如 <command-name>/foo</command-name> 时……')).toBe(false)
    })

    it('标签后跟正文的伪造位置（中部）→ 普通文本', () => {
        expect(isCliOutputText('见下：\n<local-command-stdout>x</local-command-stdout>')).toBe(false)
    })

    it('空字符串 → 普通文本', () => {
        expect(isCliOutputText('')).toBe(false)
    })
})

describe('extractStandaloneStdout', () => {
    it('纯 stdout 信封（无 command-name）→ 提取正文', () => {
        expect(extractStandaloneStdout('<local-command-stdout>已切换模型</local-command-stdout>')).toBe('已切换模型')
    })

    it('command-name + stdout 组合 → null（走合并渲染路径）', () => {
        expect(extractStandaloneStdout('<command-name>/foo</command-name>\n<local-command-stdout>out</local-command-stdout>')).toBeNull()
    })
})
