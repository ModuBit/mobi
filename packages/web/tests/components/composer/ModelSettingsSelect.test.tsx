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
 * ModelSettingsSelect（模型设置面板）行为契约：
 * ① pill 文案「模型 · 档位」，点开面板顶栏显示当前档位大字；
 * ② 模型行是 MorphSelect 弹层：点开原地长成列表（auto 单列默认组），选中后收起并更新 pill；
 * ③ 档位来自模型能力：不支持 effort 时不渲染滑杆，声明档位不足五档时不出现多余档；
 * ④ 滑杆点按轨道 / 点档位名产生同一结果（同一 onEffortChange 值）；
 * ⑤ 重置一次恢复默认模型 + 默认档。
 */

import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import type { EffortLevel, ModelInfo } from '@mobi/shared'
import { ModelSettingsSelect } from '@/features/composer/ModelSettingsSelect'

vi.mock('react-i18next', async () => {
    const { i18nKeyStub } = await import('../../helpers/i18nStub')
    return i18nKeyStub()
})

const MODELS: ModelInfo[] = [
    { value: 'opus', displayName: 'Opus', description: '最强', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'], supportsFastMode: true },
    { value: 'sonnet', displayName: 'Sonnet', description: '日常' },
    { value: 'plain', displayName: 'Plain', description: '无 effort', supportsEffort: false },
]

/** 受控宿主：把回调落到本地 state，验证面板与 pill 的联动 */
function Harness({
    initialModel = 'opus',
    initialEffort = 'medium',
    models = MODELS,
    initialFastMode = false,
    fastModeState = null,
    fastToggleable = true,
    onModelChange,
    onEffortChange,
    onFastModeChange,
}: {
    initialModel?: string
    initialEffort?: EffortLevel
    models?: ModelInfo[]
    initialFastMode?: boolean
    fastModeState?: 'off' | 'cooldown' | 'on' | null
    /** false = 调用方不提供切换回调（面板不应渲染闪电钮） */
    fastToggleable?: boolean
    onModelChange?: (m: string) => void
    onEffortChange?: (e: EffortLevel) => void
    onFastModeChange?: (enabled: boolean) => void
}) {
    const [model, setModel] = useState(initialModel)
    const [effort, setEffort] = useState<EffortLevel>(initialEffort)
    const [fastMode, setFastMode] = useState(initialFastMode)
    return (
        <ModelSettingsSelect
            label="模型"
            model={model}
            effort={effort}
            models={models}
            fastMode={fastMode}
            fastModeState={fastModeState}
            onModelChange={(m) => { setModel(m); onModelChange?.(m) }}
            onEffortChange={(e) => { setEffort(e); onEffortChange?.(e) }}
            onFastModeChange={fastToggleable ? (v) => { setFastMode(v); onFastModeChange?.(v) } : undefined}
        />
    )
}

function openPanel() {
    fireEvent.click(screen.getByRole('button', { name: '模型' }))
}

describe('ModelSettingsSelect', () => {
    afterEach(cleanup)

    it('pill 显示「模型 · 档位」', () => {
        render(<Harness />)
        expect(screen.getByRole('button', { name: '模型' })).toHaveTextContent('Opus · composer.effortLevels.medium')
    })

    it('点开面板显示当前档位大字与滑杆', () => {
        render(<Harness />)
        openPanel()
        expect(screen.getAllByText('composer.effortLevels.medium').length).toBeGreaterThan(0)
        expect(screen.getByRole('slider')).toBeInTheDocument()
    })

    it('模型行走 MorphSelect 弹层：点开列出分组，选中后收起并更新 pill', () => {
        render(<Harness />)
        openPanel()
        const select = screen.getByRole('combobox', { name: 'composer.modelPanel.selectModel' })
        expect(select).toHaveTextContent('Opus')

        fireEvent.click(select)
        expect(screen.getByRole('listbox')).toBeInTheDocument()
        expect(screen.getByRole('option', { name: /Opus/ })).toHaveAttribute('aria-selected', 'true')

        fireEvent.click(screen.getByRole('option', { name: /Sonnet/ }))
        // 列表收起（listFace 关闭态 aria-hidden），档位滑杆仍在原位
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(screen.getByRole('slider')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '模型' })).toHaveTextContent('Sonnet · composer.effortLevels.medium')
    })

    /** 轨道几何：桌面拇指 22 → 可走区间 = width - 22，起点偏移 11 */
    function mockTrack(slider: HTMLElement) {
        vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
            left: 0, width: 100, top: 0, height: 30, right: 100, bottom: 30, x: 0, y: 0, toJSON: () => ({}),
        } as DOMRect)
    }

    it('点档位名与点按轨道产生同一结果', () => {
        const onEffortChange = vi.fn()
        render(<Harness onEffortChange={onEffortChange} />)
        openPanel()

        fireEvent.click(screen.getByRole('button', { name: 'composer.effortLevels.high' }))
        expect(onEffortChange).toHaveBeenLastCalledWith('high')

        // 轨道：4 档 → 可走区间 78px；点 x=60 → ratio 0.628 → 索引 2（high）
        const slider = screen.getByRole('slider')
        mockTrack(slider)
        fireEvent.pointerDown(slider, { clientX: 60, pointerId: 1 })
        fireEvent.pointerUp(slider, { clientX: 60, pointerId: 1 })
        expect(onEffortChange).toHaveBeenLastCalledWith('high')
    })

    it('拖动过程中只预览不提交，松手吸附到最近档位', () => {
        const onEffortChange = vi.fn()
        render(<Harness initialEffort="low" onEffortChange={onEffortChange} />)
        openPanel()
        const slider = screen.getByRole('slider')
        mockTrack(slider)

        fireEvent.pointerDown(slider, { clientX: 20, pointerId: 1 })
        // 拖到两档之间的 53px（ratio 0.538 → 最近档 = 索引 2 / high），不应提交
        fireEvent.pointerMove(slider, { clientX: 53, pointerId: 1 })
        expect(onEffortChange).not.toHaveBeenCalled()

        fireEvent.pointerMove(slider, { clientX: 95, pointerId: 1 })
        fireEvent.pointerUp(slider, { clientX: 95, pointerId: 1 })
        // 一次拖动只下发一次，且落在最近档（x=95 → ratio 1 → xhigh）
        expect(onEffortChange).toHaveBeenCalledTimes(1)
        expect(onEffortChange).toHaveBeenLastCalledWith('xhigh')
    })

    it('拖动取消不提交，回到原档位', () => {
        const onEffortChange = vi.fn()
        render(<Harness initialEffort="low" onEffortChange={onEffortChange} />)
        openPanel()
        const slider = screen.getByRole('slider')
        mockTrack(slider)

        fireEvent.pointerDown(slider, { clientX: 20, pointerId: 1 })
        fireEvent.pointerMove(slider, { clientX: 95, pointerId: 1 })
        fireEvent.pointerCancel(slider, { clientX: 95, pointerId: 1 })
        expect(onEffortChange).not.toHaveBeenCalled()
    })

    it('拉到最高档才渲染星屑特效', () => {
        const withMax: ModelInfo[] = [
            { value: 'opus', displayName: 'Opus', description: '', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
        ]
        render(<Harness models={withMax} initialEffort="high" />)
        openPanel()
        expect(screen.queryAllByTestId('effort-sparkle')).toHaveLength(0)

        fireEvent.click(screen.getByRole('button', { name: 'composer.effortLevels.max' }))
        expect(screen.getAllByTestId('effort-sparkle').length).toBeGreaterThan(0)
    })

    it('重置恢复默认模型与默认档', () => {
        const onModelChange = vi.fn()
        const onEffortChange = vi.fn()
        render(<Harness initialModel="sonnet" initialEffort="xhigh" onModelChange={onModelChange} onEffortChange={onEffortChange} />)
        openPanel()
        fireEvent.click(screen.getByRole('button', { name: 'composer.modelPanel.reset' }))
        expect(onModelChange).toHaveBeenCalledWith('auto')
        expect(onEffortChange).toHaveBeenCalledWith('medium')
    })

    it('模型声明不支持 effort 时不渲染滑杆区', () => {
        render(<Harness initialModel="plain" />)
        expect(screen.getByRole('button', { name: '模型' })).toHaveTextContent('Plain')
        openPanel()
        expect(screen.queryByRole('slider')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'composer.effortLevels.low' })).not.toBeInTheDocument()
    })

    it('档位集合来自模型的 supportedEffortLevels（含 max 时出现第五档）', () => {
        const withMax: ModelInfo[] = [
            { value: 'opus', displayName: 'Opus', description: '', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
        ]
        render(<Harness models={withMax} />)
        openPanel()
        expect(screen.getByRole('button', { name: 'composer.effortLevels.max' })).toBeInTheDocument()
    })

    it('支持快速模式的模型渲染闪电钮，点击切换并点亮 pill', () => {
        const onFastModeChange = vi.fn()
        render(<Harness onFastModeChange={onFastModeChange} />)
        openPanel()
        const toggle = screen.getByRole('button', { name: 'composer.modelPanel.fastOff' })
        expect(toggle).toHaveAttribute('aria-pressed', 'false')

        fireEvent.click(toggle)
        expect(onFastModeChange).toHaveBeenCalledWith(true)
        expect(screen.getByRole('button', { name: 'composer.modelPanel.fastOn' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('模型不支持快速模式或调用方无切换回调时不渲染闪电钮', () => {
        const { unmount } = render(<Harness initialModel="plain" />)
        openPanel()
        expect(screen.queryByRole('button', { name: /composer\.modelPanel\.fast/ })).not.toBeInTheDocument()
        unmount()

        render(<Harness fastToggleable={false} />)
        openPanel()
        expect(screen.queryByRole('button', { name: /composer\.modelPanel\.fast/ })).not.toBeInTheDocument()
    })

    it('重置一并关闭快速模式', () => {
        const onFastModeChange = vi.fn()
        render(<Harness initialEffort="xhigh" initialFastMode onFastModeChange={onFastModeChange} />)
        openPanel()
        fireEvent.click(screen.getByRole('button', { name: 'composer.modelPanel.reset' }))
        expect(onFastModeChange).toHaveBeenCalledWith(false)
    })

    it('冷却态如实显示为冷却而非开启', () => {
        render(<Harness initialFastMode fastModeState="cooldown" />)
        openPanel()
        expect(screen.getByRole('button', { name: 'composer.modelPanel.fastCooldown' })).toBeInTheDocument()
    })

    it('兜底（无模型清单）时档位回落四档', () => {
        render(<Harness models={[]} />)
        openPanel()
        expect(screen.getByRole('button', { name: 'composer.effortLevels.xhigh' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'composer.effortLevels.max' })).not.toBeInTheDocument()
    })
})
