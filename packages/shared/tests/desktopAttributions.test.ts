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
 * 归因注册表完备性：三端（hub teardown / cli 关闭 / web 决策与文案）共享这张表，
 * 条目的 code/prose/i18nKey 一致性在此一处锁死——新增归因漏改任何一端都会在这里红。
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    DESKTOP_CLOSE_ATTRIBUTIONS,
    desktopCloseAttributionByCode,
    desktopCloseAttributionByProse,
    type DesktopCloseAttributionId,
} from '../src/desktopProtocol'

const WEB_ROOT = join(__dirname, '..', '..', 'web', 'src')

describe('DESKTOP_CLOSE_ATTRIBUTIONS 完备性', () => {
    it('code 全局唯一（null 除外）', () => {
        const codes = Object.values(DESKTOP_CLOSE_ATTRIBUTIONS)
            .map((a) => a.code)
            .filter((code): code is number => code !== null)
        expect(new Set(codes).size).toBe(codes.length)
    })

    it('prose 全局唯一（prose 即协议）', () => {
        const proses = Object.values(DESKTOP_CLOSE_ATTRIBUTIONS).map((a) => a.prose)
        expect(new Set(proses).size).toBe(proses.length)
    })

    it('不可重连的归因必须有专属文案；可重连的无键（回退通用断开文案）', () => {
        for (const [id, attribution] of Object.entries(DESKTOP_CLOSE_ATTRIBUTIONS)) {
            if (!attribution.retryable) {
                expect({ id, i18nKey: attribution.i18nKey }).toMatchObject({ i18nKey: expect.any(String) })
            } else {
                expect(attribution.i18nKey).toBeNull()
            }
        }
    })

    it('每个 i18nKey 在 zh/en 两份 locale 中都存在', () => {
        for (const locale of ['zh', 'en']) {
            const locales = JSON.parse(readFileSync(join(WEB_ROOT, 'core', 'config', 'i18n', 'locales', `${locale}.json`), 'utf8')) as Record<string, unknown>
            for (const [id, attribution] of Object.entries(DESKTOP_CLOSE_ATTRIBUTIONS)) {
                if (attribution.i18nKey === null) continue
                const value = attribution.i18nKey.split('.').reduce<unknown>((node, segment) => {
                    return typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[segment] : undefined
                }, locales)
                expect({ locale, id, key: attribution.i18nKey, value: typeof value }).toMatchObject({ value: 'string' })
            }
        }
    })

    it('按 code / 按 prose 查询互洽', () => {
        for (const id of Object.keys(DESKTOP_CLOSE_ATTRIBUTIONS) as DesktopCloseAttributionId[]) {
            const attribution = DESKTOP_CLOSE_ATTRIBUTIONS[id]
            if (attribution.code !== null) {
                expect(desktopCloseAttributionByCode(attribution.code)).toMatchObject({ prose: attribution.prose })
            }
            expect(desktopCloseAttributionByProse(attribution.prose)).toMatchObject({ code: attribution.code })
        }
        // 查不到 = 网络类/协议类（走重连与通用文案），不抛错
        expect(desktopCloseAttributionByCode(1006)).toBeNull()
        expect(desktopCloseAttributionByProse('attach timeout')).toBeNull()
    })

    it('locale 文件在仓库内（防测试路径漂移后静默空转）', () => {
        expect(existsSync(join(WEB_ROOT, 'core', 'config', 'i18n', 'locales', 'zh.json'))).toBe(true)
    })
})
