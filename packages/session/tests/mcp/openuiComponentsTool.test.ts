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
 * openui_components 工具测试：签名按需检索的匹配语义（prompt 分层配套，2026-10-19）。
 *
 * 断言对象是外部行为：query → 返回文本（命中签名 / 未命中提示名录），不测内部实现。
 * 数据源是生成产物（95 组件），存在性断言锚定官方组件名（升级 react-ui 时若改名会红，
 * 属预期提醒而非脆弱断言）。
 */

import { describe, it, expect } from 'vitest'
import { executeOpenuiComponents, OPENUI_COMPONENTS_TOOL_NAME } from '@/mcp/openuiComponentsTool'
import { OPENUI_COMPONENT_CATALOG } from '@/claude/utils/openuiCatalog.generated'

const text = (r: { content: Array<{ type: 'text'; text: string }> }) => r.content[0]!.text

describe('openui_components', () => {
    it('工具名与 prompt 引导句一致（B/C 档路由指向 openui_components）', () => {
        expect(OPENUI_COMPONENTS_TOOL_NAME).toBe('openui_components')
    })

    it('精确名命中：返回完整签名 + 描述', async () => {
        const r = await executeOpenuiComponents({ query: 'DatePicker' })
        expect(r.isError).toBeFalsy()
        expect(text(r)).toMatch(/DatePicker\(/)
        expect(text(r)).not.toContain('Carousel(')
    })

    it('逗号分隔多名命中 + 子串大小写不敏感', async () => {
        const r = await executeOpenuiComponents({ query: 'carousel, tabs' })
        const t = text(r)
        expect(t).toMatch(/Carousel\(/)
        expect(t).toMatch(/Tabs\(/)
    })

    it('子串会带出同名前缀族（table 命中 Table 与 EditableTable 等）', async () => {
        const r = await executeOpenuiComponents({ query: 'table' })
        expect(text(r)).toMatch(/Table\(columns:/)
    })

    it('未命中：isError=false + 返回全部组件名提示（改名重试比报错便宜）', async () => {
        const r = await executeOpenuiComponents({ query: 'NoSuchThing' })
        expect(r.isError).toBeFalsy()
        expect(text(r)).toContain('No openui component or function matches')
        expect(text(r)).toContain('Stack')
    })

    it('函数双检索（2026-10-19 函数名录化）：@词或裸名命中，返回 @ 签名', async () => {
        const withAt = await executeOpenuiComponents({ query: '@Format' })
        expect(text(withAt)).toMatch(/@Format\(/)
        const bare = await executeOpenuiComponents({ query: 'GroupBy' })
        expect(text(bare)).toMatch(/@GroupBy\(/)
    })

    it('组件与函数混合查询：一次往返同时取双目录', async () => {
        const r = await executeOpenuiComponents({ query: 'DatePicker, @Payment' })
        const t = text(r)
        expect(t).toMatch(/DatePicker\(/)
        expect(t).toMatch(/@Payment\(/)
    })

    it('非法入参（空 query）→ isError', async () => {
        const r = await executeOpenuiComponents({ query: '' })
        expect(r.isError).toBe(true)
    })

    it('catalog 覆盖官方 95 组件（升级 react-ui 后数字变化须同步 prompt 名录）', () => {
        expect(OPENUI_COMPONENT_CATALOG.length).toBe(95)
        for (const name of ['Stack', 'Map', 'Chart', 'Svg', 'HtmlView', 'LineChart', 'Carousel']) {
            expect(OPENUI_COMPONENT_CATALOG.some((e) => e.name === name)).toBe(true)
        }
        // 每项都有非空签名（名录缺签名 = 检索工具白挂）
        for (const e of OPENUI_COMPONENT_CATALOG) expect(e.signature.length).toBeGreaterThan(0)
    })
})
