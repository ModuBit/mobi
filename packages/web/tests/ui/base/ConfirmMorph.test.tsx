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
 * uiarc confirm-morph 自管件的行为契约（button-migration 票 01）：
 * 两态确认主路径（idle → confirming → done）、语义红线「armed 态再点 = 确认」（prompt 区
 * 与 Confirm 钮双通路）、退出通路（Escape/外点/超时）、pending/undo/error 通路、hold 与
 * countdown 变体主路径。宽度 morph / 面部 crossfade 观感是 jsdom 测不出的真机验收项。
 *
 * 测试基建说明：
 * - i18n key 直通桩 → 断言 uiarc.confirmMorph.* key 文本；
 * - motion 桩即完即达（置值 + setTimeout(0) resolve），故 armed 用例关 confirmTimeout
 *   独占时间；超时用例依赖桩的即时完成验证 expire → cancel 机制；
 * - 上游 ARM_MS（280ms）把「展开后立刻的点击」判为尾击不确认，armed 再点用例须隔开
 *   真实时间（>280ms）模拟真人二击节奏；
 * - AnimatePresence 的离场面在 jsdom 里随真实时长淡出，回 idle 的断言用 waitFor 等
 *   旧触发器离场，避免按钮重名歧义。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen, waitFor, act } from '@testing-library/react'
import { ConfirmMorph } from '@/ui/base/interactive/confirm-morph/ConfirmMorph'

vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../../helpers/motionReactStub')
    const stub = await motionReactStub(importOriginal)
    // 本组件的超时 clock 会 sync() control.play/pause（悬停暂停），共享桩没有这两个方法——本地补齐
    return {
        ...stub,
        animate: (...args: Parameters<typeof stub.animate>) => {
            const control = stub.animate(...args)
            return { ...control, pause() {}, play() {} }
        },
    }
})

vi.mock('react-i18next', async () => {
    const { i18nKeyStub } = await import('../../helpers/i18nStub')
    return i18nKeyStub()
})

afterEach(cleanup)

/** armed 态用例默认关两段超时，独占断言窗口（0 = 上游语义的关闭档） */
const renderMorph = (props: Partial<Parameters<typeof ConfirmMorph>[0]> = {}) =>
    render(<ConfirmMorph label="删除项目" confirmTimeout={0} resultTimeout={0} {...props} />)

/** 与展开那一下隔开 ARM_MS（280ms），模拟真人二击节奏 */
const pastArm = () => act(async () => { await new Promise((r) => setTimeout(r, 320)) })

/** 等旧触发器离场（exit 动画走真实时长），单义断言回到 idle */
const backToIdle = () => waitFor(() => {
    expect(screen.getAllByRole('button', { name: '删除项目' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'uiarc.confirmMorph.confirm' })).toBeNull()
})

describe('uiarc ConfirmMorph ariaLabel 透传（icon-only label 场景）', () => {
    it('ariaLabel 挂触发钮可访问名，label 文本可同时为空', () => {
        renderMorph({ label: '', icon: <span data-testid="glyph" />, ariaLabel: '停止任务' })
        expect(screen.getByRole('button', { name: '停止任务' })).toBeInTheDocument()
    })
})

describe('uiarc ConfirmMorph 两态确认主路径', () => {
    it('初次点击进入 armed 确认态（prompt/cancel/confirm 就位），不触发 onConfirm', () => {
        const onConfirm = vi.fn()
        renderMorph({ onConfirm })

        fireEvent.click(screen.getByRole('button', { name: '删除项目' }))

        expect(screen.getByText('删除项目?')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'uiarc.confirmMorph.cancel' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'uiarc.confirmMorph.confirm' })).toBeInTheDocument()
        expect(onConfirm).not.toHaveBeenCalled()
    })

    it('armed 再点 Confirm 钮触发 onConfirm，落到 done 面', async () => {
        const onConfirm = vi.fn()
        renderMorph({ onConfirm })

        fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
        await pastArm()
        fireEvent.click(screen.getByRole('button', { name: 'uiarc.confirmMorph.confirm' }))

        expect(onConfirm).toHaveBeenCalledTimes(1)
        // done 文案同时出现在可见 statusText 与 srOnly 播报里，getAll 断言存在即可
        await waitFor(() => expect(screen.getAllByText('uiarc.confirmMorph.done').length).toBeGreaterThan(0))
    })

    it('语义红线：armed 再点原按钮区（prompt 文本）即确认，无须点独立确认钮', async () => {
        const onConfirm = vi.fn()
        renderMorph({ onConfirm })

        fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
        await pastArm()
        // 点的是原按钮所在位置的 prompt 文本，不是 Confirm 钮
        fireEvent.click(screen.getByText('删除项目?'))

        expect(onConfirm).toHaveBeenCalledTimes(1)
        await waitFor(() => expect(screen.getAllByText('uiarc.confirmMorph.done').length).toBeGreaterThan(0))
    })
})

describe('uiarc ConfirmMorph 退出通路', () => {
    it('Escape 回 idle 并回调 onCancel', async () => {
        const onCancel = vi.fn()
        renderMorph({ onCancel })

        fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
        fireEvent.keyDown(screen.getByRole('button', { name: 'uiarc.confirmMorph.confirm' }), { key: 'Escape' })

        expect(onCancel).toHaveBeenCalledTimes(1)
        await backToIdle()
    })

    it('外点回 idle 并回调 onCancel', async () => {
        const onCancel = vi.fn()
        renderMorph({ onCancel })

        fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
        fireEvent.pointerDown(document.body)

        expect(onCancel).toHaveBeenCalledTimes(1)
        await backToIdle()
    })

    it('确认态超时（confirmTimeout）自动复原并回调 onCancel', async () => {
        const onCancel = vi.fn()
        // 缺省 confirmTimeout（6000）：clock 走 motion 桩即完即达，验证的是超时 → expire → cancel 机制
        render(<ConfirmMorph label="删除项目" onCancel={onCancel} />)

        fireEvent.click(screen.getByRole('button', { name: '删除项目' }))

        await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
        await backToIdle()
    })
})

describe('uiarc ConfirmMorph 结果通路', () => {
    it('onConfirm 返回 pending promise：pending 面 + aria-busy，resolve 后落 done', async () => {
        let resolve!: (v: unknown) => void
        const onConfirm = vi.fn(() => new Promise((r) => { resolve = r }))
        renderMorph({ onConfirm })

        fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
        await pastArm()
        fireEvent.click(screen.getByRole('button', { name: 'uiarc.confirmMorph.confirm' }))

        // pending 文案同时出现在可见 statusText 与 srOnly 播报里
        expect((await screen.findAllByText('uiarc.confirmMorph.pending')).length).toBeGreaterThan(0)
        expect(document.querySelector('[data-state="pending"][aria-busy="true"]')).not.toBeNull()

        resolve(undefined)
        expect((await screen.findAllByText('uiarc.confirmMorph.done')).length).toBeGreaterThan(0)
    })

    it('undo 通路：done 面出现 Undo，点击回调 onUndo 并回 idle', async () => {
        const onConfirm = vi.fn(() => Promise.resolve())
        const onUndo = vi.fn(() => Promise.resolve())
        renderMorph({ onConfirm, onUndo })

        fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
        await pastArm()
        fireEvent.click(screen.getByRole('button', { name: 'uiarc.confirmMorph.confirm' }))
        expect(await screen.findByRole('button', { name: 'uiarc.confirmMorph.undo' })).toBeInTheDocument()
        expect(onUndo).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'uiarc.confirmMorph.undo' }))

        expect(onUndo).toHaveBeenCalledTimes(1)
        await backToIdle()
    })

    it('onConfirm 同步抛错落 error 面，Retry 重试同一动作', async () => {
        const onConfirm = vi.fn(() => { throw new Error('boom') })
        renderMorph({ onConfirm })

        fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
        await pastArm()
        fireEvent.click(screen.getByRole('button', { name: 'uiarc.confirmMorph.confirm' }))

        expect((await screen.findAllByText('uiarc.confirmMorph.error')).length).toBeGreaterThan(0)
        fireEvent.click(screen.getByRole('button', { name: 'uiarc.confirmMorph.retry' }))

        expect(onConfirm).toHaveBeenCalledTimes(2)
    })
})

describe('uiarc ConfirmMorph hold / countdown 变体', () => {
    it('hold 变体：按住至充满即确认（motion 桩即满即达）', async () => {
        const onConfirm = vi.fn()
        renderMorph({ confirmMode: 'hold', onConfirm })

        fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
        fireEvent.pointerDown(screen.getByRole('button', { name: 'uiarc.confirmMorph.confirm' }), { button: 0, pointerId: 1 })

        await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    })

    it('countdown 变体：确认后进倒数面（ring + 秒数），倒数归零自动执行', async () => {
        const onConfirm = vi.fn()
        renderMorph({ confirmMode: 'countdown', onConfirm })

        fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
        await pastArm()
        fireEvent.click(screen.getByRole('button', { name: 'uiarc.confirmMorph.confirm' }))

        expect((await screen.findAllByText('uiarc.confirmMorph.countdownPrefix')).length).toBeGreaterThan(0)
        await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    })
})
