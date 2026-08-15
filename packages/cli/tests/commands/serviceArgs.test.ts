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
 * 验证 service 命令族 --host/--port 参数解析与端口校验。
 *
 * @see packages/cli/src/commands/serviceArgs.ts
 */

import { describe, expect, it } from 'vitest'
import { parseHostPortArgs } from '@/commands/serviceArgs'

describe('parseHostPortArgs', () => {
    it('解析空格形式 --host x 与 --port 8080', () => {
        expect(parseHostPortArgs(['--host', '0.0.0.0', '--port', '8080'])).toEqual({
            host: '0.0.0.0',
            port: 8080,
        })
    })

    it('解析等号形式 --host=x 与 --port=8080', () => {
        expect(parseHostPortArgs(['--host=0.0.0.0', '--port=8080'])).toEqual({
            host: '0.0.0.0',
            port: 8080,
        })
    })

    it('混合两种形式', () => {
        expect(parseHostPortArgs(['--host', '192.168.1.1', '--port=9000'])).toEqual({
            host: '192.168.1.1',
            port: 9000,
        })
    })

    it('无参数返回空对象', () => {
        expect(parseHostPortArgs([])).toEqual({})
    })

    it('末位缺值静默忽略（不抛错）', () => {
        expect(parseHostPortArgs(['--host'])).toEqual({})
        expect(parseHostPortArgs(['--port'])).toEqual({})
    })

    it('非法端口 abc 抛错（空格形式）', () => {
        expect(() => parseHostPortArgs(['--port', 'abc'])).toThrow(
            'Invalid port: abc. Must be a number between 1 and 65535',
        )
    })

    it('非法端口 abc 抛错（等号形式）', () => {
        expect(() => parseHostPortArgs(['--port=abc'])).toThrow(
            'Invalid port: abc. Must be a number between 1 and 65535',
        )
    })

    it('越界端口 0 抛错', () => {
        expect(() => parseHostPortArgs(['--port', '0'])).toThrow(
            'Invalid port: 0. Must be a number between 1 and 65535',
        )
    })

    it('越界端口 70000 抛错', () => {
        expect(() => parseHostPortArgs(['--port', '70000'])).toThrow(
            'Invalid port: 70000. Must be a number between 1 and 65535',
        )
    })
})
