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
 * DiffView（工具卡 diff 换 @pierre/diffs 渲染核）边界单测：
 * 双轨数据源 → 合成 patch 文本、空 diff 守卫降级、渲染 options。
 * 渲染本体不测（信任库，审查面板 PoC 已验）——PatchDiff 以桩替换捕获 props。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const captured: Array<{ patch: string; options: Record<string, unknown> }> = []
vi.mock('@pierre/diffs/react', () => ({
    PatchDiff: ({ patch, options }: { patch: string; options: Record<string, unknown> }) => {
        captured.push({ patch, options })
        return <div data-testid="patch-diff-stub" />
    },
}))
// pierreTheme 预热 side effect 在 jsdom 无意义，桩掉
vi.mock('@/components/review/pierreTheme', () => ({ PIERRE_BRIDGE_VARS: {} }))

import { DiffView } from '@/components/tool-card/views/DiffView'

afterEach(() => {
    cleanup()
    captured.length = 0
})

describe('DiffView 渲染核（PatchDiff）', () => {
    it('structuredPatch 优先：合成 unified patch 文本（带头 + hunk 头）', () => {
        render(
            <DiffView
                oldString="const old"
                newString="const new"
                structuredPatches={[{ oldStart: 7, oldLines: 1, newStart: 7, newLines: 1, lines: ['-const old', '+const new'] }]}
                filePath="src/app.ts"
            />,
        )
        expect(captured).toHaveLength(1)
        expect(captured[0]!.patch.split('\n')).toEqual([
            '--- a/src/app.ts',
            '+++ b/src/app.ts',
            '@@ -7,1 +7,1 @@',
            '-const old',
            '+const new',
        ])
    })

    it('无 structuredPatch：old/new 自 diff 回退合成（空 old 产生删除行——diffLines 既有语义）', () => {
        render(<DiffView oldString="" newString={'l1\nl2'} />)
        expect(captured[0]!.patch.split('\n')).toEqual([
            '--- a/_',
            '+++ b/_',
            '@@ -1,1 +1,2 @@',
            '-',
            '+l1',
            '+l2',
        ])
    })

    it('渲染 options：unified / scroll / simple 分隔 / 无文件头', () => {
        render(<DiffView oldString="a" newString="b" />)
        expect(captured[0]!.options).toMatchObject({
            diffStyle: 'unified',
            overflow: 'scroll',
            hunkSeparators: 'simple',
            disableFileHeader: true,
        })
    })

})
