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
 * @pierre/diffs 集成 PoC（审查重写票01 硬门禁）：四条硬风险实测页——
 * ① Shadow DOM 双主题（antd token 桥，pierreTheme.ts）
 * ② 大 patch（3200 行）滚动性能（CPU throttle 由 devtools 施加）
 * ③ hydration 链路（loadDiffFiles 成功/失败双实例：成功翻转 partial 可展开，
 *    失败静默降级纯 patch 不白屏）
 * ④ 空态（无 diff 内容的诚实降级）
 *
 * dev-only：/src/dev 下，生产路由不注册（router.tsx DEV 守卫）。
 */

import { useMemo, useState, type CSSProperties } from 'react'
import { MultiFileDiff, PatchDiff } from '@pierre/diffs/react'
import { Button, Flex, Radio, Typography } from 'antd'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { PIERRE_BRIDGE_VARS } from './pierreTheme'

/** 生成 ≥3000 行的真实 git patch 样例（确定性伪随机，便于人工核对行号；hunk 头按实际行数统计） */
function buildBigPatch(): string {
    const lines: string[] = ['diff --git a/src/big.ts b/src/big.ts', 'index 1111111..2222222 100644', '--- a/src/big.ts', '+++ b/src/big.ts']
    const HUNK = 500
    for (let hunk = 0; hunk < 8; hunk++) {
        const body: string[] = []
        for (let i = 0; i < HUNK; i++) {
            const n = hunk * HUNK + i
            if (i === 10) {
                body.push(`-const removed${n} = ${hunk}-${i}`)
                body.push(`+const added${n} = ${hunk}+${i} // changed in hunk ${hunk}`)
                body.push(`+const extraA${n} = 'new'`)
                continue
            }
            if (i === 200) {
                body.push(`+const extraB${n} = ${hunk}`)
                body.push(`+const extraC${n} = ${hunk}`)
                continue
            }
            body.push(` const ctx${n} = ${i} // hunk ${hunk}`)
        }
        // hunk 头按 git 语义统计：old = 空格/- 行，new = 空格/+ 行
        const oldCount = body.filter((l) => l[0] === ' ' || l[0] === '-').length
        const newCount = body.filter((l) => l[0] === ' ' || l[0] === '+').length
        lines.push(`@@ -${hunk * HUNK + 1},${oldCount} +${hunk * HUNK + 1},${newCount} @@`, ...body)
    }
    return lines.join('\n')
}

const BIG_PATCH = buildBigPatch()

/** 全文对样例（MultiFileDiff 通道，400 行文字 + 少量真实增删） */
function buildFileContents(seed: 'old' | 'new'): string {
    const lines: string[] = []
    for (let i = 1; i <= 400; i++) {
        if (seed === 'old' && i === 50) {
            lines.push('const oldValue = { stale: true, note: "will be rewritten" }')
            continue
        }
        if (seed === 'new' && i === 50) {
            lines.push('const newValue = { fresh: true, note: "rewritten in this change" }')
            lines.push('const appended = 42')
            continue
        }
        lines.push(`export const line${i} = ${i} // ${seed === 'old' ? 'v1' : 'v2'}`)
    }
    return lines.join('\n')
}

/** 小 patch（partial：只有 hunk，无全文）——hydration 的载体 */
const PARTIAL_PATCH = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 3333333..4444444 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -10,3 +10,4 @@',
    ' const existing = 1',
    '-const old = 2',
    '+const fresh = 2',
    "+const another = 'x'",
    ' const more = 3',
].join('\n')

type LoaderBehavior = 'success' | 'failure'

function makeLoadDiffFiles(behavior: LoaderBehavior) {
    return async () => {
        await new Promise((resolve) => setTimeout(resolve, 300)) // 假延迟：hydration 期间交互观察
        if (behavior === 'failure') throw new Error('simulated contents fetch failure')
        return {
            oldFile: { name: 'src/app.ts', contents: buildFileContents('old') },
            newFile: { name: 'src/app.ts', contents: buildFileContents('new') },
        }
    }
}

export default function PocPierreDiff() {
    const theme = useUiStore((s) => s.theme)
    const setTheme = useUiStore((s) => s.setTheme)
    const resolved = resolveTheme(theme)
    const [layout, setLayout] = useState<'unified' | 'split'>('unified')
    const [wrap, setWrap] = useState(false)

    const options = useMemo(
        () => ({
            // 默认 pierre-dark/pierre-light 双主题；结构色由 PIERRE_BRIDGE_VARS 桥 antd token
            themeType: resolved as 'light' | 'dark',
            diffStyle: layout,
            overflow: wrap ? ('wrap' as const) : ('scroll' as const),
            hunkSeparators: 'line-info' as const,
            disableFileHeader: true,
        }),
        [resolved, layout, wrap],
    )
    // host 元素 inline style：桥接变量 + 尺寸（inline 优先级压过 shadow :host 主题规则）
    const hostStyle = { ...PIERRE_BRIDGE_VARS, height: '100%' } as CSSProperties

    return (
        <Flex vertical gap={16} style={{ padding: 16, height: '100vh', overflow: 'auto', background: 'var(--ant-color-bg-layout)' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>@pierre/diffs PoC（票01 硬门禁）</Typography.Title>
            <Flex align="center" gap={12}>
                <Radio.Group
                    size="small"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    options={[
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' },
                        { value: 'system', label: 'System' },
                    ]}
                    optionType="button"
                />
                <Radio.Group
                    size="small"
                    value={layout}
                    onChange={(e) => setLayout(e.target.value)}
                    options={[
                        { value: 'unified', label: 'Unified' },
                        { value: 'split', label: 'Split' },
                    ]}
                    optionType="button"
                />
                <Button size="small" onClick={() => setWrap((v) => !v)}>{wrap ? 'Wrap: on' : 'Wrap: off'}</Button>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    ① 双主题 ② 大 patch 滚动 ③ hydration 成功/失败 ④ 空态
                </Typography.Text>
            </Flex>

            {/* ② 大 patch（3200+ 行，虚拟化 + 滚动性能实测载体） */}
            <section data-testid="poc-big-patch">
                <Typography.Text strong style={{ fontSize: 12 }}>② PatchDiff · big patch（{BIG_PATCH.split('\n').length} 行）</Typography.Text>
                <div style={{ height: 360, overflow: 'auto', border: '1px solid var(--ant-color-border)' }}>
                    <PatchDiff patch={BIG_PATCH} options={options} style={hostStyle} />
                </div>
            </section>

            {/* ③ hydration：成功路径（300ms 后全文到位，折叠上下文可展开） */}
            <section data-testid="poc-hydration-success">
                <Typography.Text strong style={{ fontSize: 12 }}>③a hydration · loadDiffFiles 成功（300ms）</Typography.Text>
                <div style={{ height: 280, overflow: 'auto', border: '1px solid var(--ant-color-border)' }}>
                    <PatchDiff patch={PARTIAL_PATCH} options={{ ...options, loadDiffFiles: makeLoadDiffFiles('success') }} style={hostStyle} />
                </div>
            </section>

            {/* ③b hydration：失败路径（reject 后仍展示纯 patch，不白屏） */}
            <section data-testid="poc-hydration-failure">
                <Typography.Text strong style={{ fontSize: 12 }}>③b hydration · loadDiffFiles 恒 reject（降级不白屏）</Typography.Text>
                <div style={{ height: 200, overflow: 'auto', border: '1px solid var(--ant-color-border)' }}>
                    <PatchDiff patch={PARTIAL_PATCH} options={{ ...options, loadDiffFiles: makeLoadDiffFiles('failure') }} style={hostStyle} />
                </div>
            </section>

            {/* ① 全文对通道（MultiFileDiff：contents 直渲染，old/new） */}
            <section data-testid="poc-multifile">
                <Typography.Text strong style={{ fontSize: 12 }}>① MultiFileDiff · old/new 全文对（双主题观察主载体）</Typography.Text>
                <div style={{ height: 300, overflow: 'auto', border: '1px solid var(--ant-color-border)' }}>
                    <MultiFileDiff
                        oldFile={{ name: 'src/app.ts', contents: buildFileContents('old') }}
                        newFile={{ name: 'src/app.ts', contents: buildFileContents('new') }}
                        options={options}
                        style={hostStyle}
                    />
                </div>
            </section>

            {/* ④ 空态：PatchDiff 对空 patch 直接 throw（PoC 实证）——上层必须守卫，
                空时降级自有 UI（与票07 的 contents 通道兜底一致） */}
            <section data-testid="poc-empty">
                <Typography.Text strong style={{ fontSize: 12 }}>④ 空 patch（守卫降级，PatchDiff 空串会 throw）</Typography.Text>
                <div style={{ height: 120, border: '1px solid var(--ant-color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>
                    无 diff 内容
                </div>
            </section>
        </Flex>
    )
}
