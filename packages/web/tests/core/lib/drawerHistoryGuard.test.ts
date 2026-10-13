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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { pushHistoryGuard, __resetHistoryGuardForTest } from '@/core/lib/drawerHistoryGuard'

/** 同步派发一次 popstate（模拟用户手势返回）。
 *  `landed` = 浏览器这次回退**落在**的那条 entry 的 state（Chrome 语义：event.state 是目的 entry 的
 *  state）；省略/null 表示落在路由层 entry（无哨兵标记） */
const firePopstate = (landed?: { mobiHistoryGuard: true; guardId: number }): void =>
    window.dispatchEvent(new PopStateEvent('popstate', { state: landed ?? null }))
/** 当前栈顶哨兵的 guardId（jsdom 的 history.state 即最后一次 pushState 的 state） */
const topGuardId = (): number =>
    (window.history.state as { mobiHistoryGuard?: boolean; guardId: number }).guardId
/** flush 微任务队列 —— dispose 的 back 决策异步化后，断言前需 await */
const flushMicrotasks = (): Promise<void> => new Promise(queueMicrotask)

describe('drawerHistoryGuard', () => {
    beforeEach(() => {
        __resetHistoryGuardForTest()
        // jsdom 的 history.back() 不稳定触发 popstate，而真实浏览器会触发。
        // 同步模拟浏览器语义：back() 立即派发一次 popstate（由 guard 的 suppressCount 抑制）
        vi.spyOn(window.history, 'back').mockImplementation(() => {
            window.dispatchEvent(new PopStateEvent('popstate'))
        })
    })
    afterEach(() => vi.restoreAllMocks())

    it('手势返回（popstate）触发 onBackPressed 收起覆盖物', () => {
        const back = vi.fn()
        pushHistoryGuard(back)
        expect(back).not.toHaveBeenCalled()
        firePopstate()
        expect(back).toHaveBeenCalledTimes(1)
    })

    it('纯关闭（无导航）：dispose 微任务中 back 弹掉哨兵，onBackPressed 不触发', async () => {
        const back = vi.fn()
        const dispose = pushHistoryGuard(back)
        dispose()
        await flushMicrotasks()
        // back 弹哨兵，popstate 由 suppressCount 抑制 → onBackPressed 不调
        expect(window.history.back).toHaveBeenCalledTimes(1)
        expect(back).not.toHaveBeenCalled()
    })

    it('导航异步 flush 竞态：flush 已落地后 dispose 不误 back（切 session 回归）', async () => {
        const back = vi.fn()
        const dispose = pushHistoryGuard(back)
        // 模拟 TanStack Router navigate 的 flush 在 dispose 微任务之前落地：
        // history.state 已变为路由 entry（无 mobiHistoryGuard）—— 点 session 切换的真实时序
        window.history.replaceState({ key: 'tsr-router-entry' }, '')
        dispose()
        await flushMicrotasks()
        // 不误 back —— 路由 entry 留栈顶，navigate 不被抵消（修复前的 bug：URL 被拉回）
        expect(window.history.back).not.toHaveBeenCalled()
        expect(back).not.toHaveBeenCalled()
    })

    it('嵌套场景后入先出：手势返回只收起栈顶覆盖物', () => {
        const inner = vi.fn() // 先 push：底层（如 InspectorPane）
        const outer = vi.fn() // 后 push：顶层（如 drawer）
        pushHistoryGuard(inner)
        const innerId = topGuardId()
        pushHistoryGuard(outer)

        // 从顶层返回 → 落在底层的哨兵 entry 上 → 只收顶层
        firePopstate({ mobiHistoryGuard: true, guardId: innerId })
        expect(outer).toHaveBeenCalledTimes(1)
        expect(inner).not.toHaveBeenCalled()

        // 从底层哨兵返回 → 落在路由层 entry 上 → 收底层
        firePopstate()
        expect(inner).toHaveBeenCalledTimes(1)
    })

    // 真机回归（2026-10-13）：同一时刻连按返回键，浏览器把多次回退合并成一次多级回退——
    // 吞掉 N 条 entry 只派发一个 popstate。按次数递减的旧记账会与真实 entry 失配，
    // 哨兵提前耗尽，用户再按一次返回就落到路由 entry 上（表现为「关掉二级后再返回直接退出页面」）。
    it('合并回退落到路由层：一次 popstate 收起沿途所有覆盖物（不残留失配）', () => {
        const panel = vi.fn()
        const editor = vi.fn()
        const picker = vi.fn()
        pushHistoryGuard(panel)
        pushHistoryGuard(editor)
        pushHistoryGuard(picker)

        // 连按两次返回被合并：吞掉 picker + editor 两条 entry，只派发一个落点在路由层的 popstate。
        // 落到路由层 = 用户实际退到了所有哨兵之下 → 沿途覆盖物全部收起（顶层先收）
        firePopstate()
        expect(picker).toHaveBeenCalledTimes(1)
        expect(editor).toHaveBeenCalledTimes(1)
        expect(panel).toHaveBeenCalledTimes(1)
        // 收起顺序必须自顶向下（后入先出）
        expect(picker.mock.invocationCallOrder[0]).toBeLessThan(editor.mock.invocationCallOrder[0])
        expect(editor.mock.invocationCallOrder[0]).toBeLessThan(panel.mock.invocationCallOrder[0])
    })

    it('合并回退跨级：落在栈中某层哨兵上 → 其上全部收起，其下不动', () => {
        const bottom = vi.fn()
        const middle = vi.fn()
        const top = vi.fn()
        pushHistoryGuard(bottom)
        const bottomId = topGuardId()
        pushHistoryGuard(middle)
        pushHistoryGuard(top)

        firePopstate({ mobiHistoryGuard: true, guardId: bottomId })
        expect(top).toHaveBeenCalledTimes(1)
        expect(middle).toHaveBeenCalledTimes(1)
        expect(bottom).not.toHaveBeenCalled()
    })

    it('自弹与用户返回被合并成一次多级回退：抑制不等于不记账（真机顺序两次返回退出页面）', async () => {
        const panel = vi.fn()
        const editor = vi.fn()
        const picker = vi.fn()
        pushHistoryGuard(panel)
        const panelId = topGuardId()
        pushHistoryGuard(editor)
        const editorId = topGuardId()
        pushHistoryGuard(picker)

        // 用户第一次返回：落点在 editor 的 entry 上 → 只收起 picker
        firePopstate({ mobiHistoryGuard: true, guardId: editorId })
        expect(picker).toHaveBeenCalledTimes(1)
        expect(editor).not.toHaveBeenCalled()

        // picker 离场窗口内重臂哨兵（底部 sheet 的 guardEpoch 重推）
        const rearmedPicker = vi.fn()
        const disposeRearmed = pushHistoryGuard(rearmedPicker)

        // 重臂哨兵的 dispose 自弹 + 用户紧接着的第二次返回被浏览器合并成一次多级回退：
        // 吞掉「重臂哨兵 + editor 哨兵」两条 entry，只派发一个落点在 panel 上的 popstate
        vi.mocked(window.history.back).mockImplementation(() => {
            window.dispatchEvent(
                new PopStateEvent('popstate', { state: { mobiHistoryGuard: true, guardId: panelId } }),
            )
        })
        disposeRearmed()
        await flushMicrotasks()

        // 抑制位不为「无条件吞掉」：按落点记账 → 落点之上的 editor 收起（用户第二次返回生效，
        // 而不是被吞掉后留待下一次返回穿透到路由 entry）
        expect(editor).toHaveBeenCalledTimes(1)
        expect(panel).not.toHaveBeenCalled()
    })

    it('合并回退后覆盖物卸载：dispose 不再补 back（否则会弹掉路由 entry 退出页面）', async () => {
        const inner = vi.fn()
        const outer = vi.fn()
        const disposeInner = pushHistoryGuard(inner)
        const disposeOuter = pushHistoryGuard(outer)

        firePopstate() // 合并回退：整栈收起
        disposeOuter()
        disposeInner()
        await flushMicrotasks()
        // 两条哨兵 entry 都被这次回退吞掉了，dispose 不得再 back（栈顶已是路由 entry）
        expect(window.history.back).not.toHaveBeenCalled()
    })

    it('dispose 已被 popstate 消费的哨兵为空操作，不重复触发回调', async () => {
        const back = vi.fn()
        const dispose = pushHistoryGuard(back)
        firePopstate() // 消费哨兵
        expect(back).toHaveBeenCalledTimes(1)
        expect(() => dispose()).not.toThrow()
        await flushMicrotasks()
        expect(back).toHaveBeenCalledTimes(1) // 不再触发
    })

    it('dispose 后再 push 新哨兵仍正常工作', async () => {
        const a = vi.fn()
        const disposeA = pushHistoryGuard(a)
        disposeA()
        await flushMicrotasks() // 旧哨兵已被 back 弹掉

        const b = vi.fn()
        pushHistoryGuard(b)
        firePopstate()
        expect(b).toHaveBeenCalledTimes(1)
        expect(a).not.toHaveBeenCalled()
    })

    it('嵌套时主动关闭顶层不影响底层（栈序正确）', async () => {
        const inner = vi.fn()
        const outer = vi.fn()
        pushHistoryGuard(inner)
        const disposeOuter = pushHistoryGuard(outer)

        disposeOuter() // 用户主动关顶层 drawer
        await flushMicrotasks()
        expect(outer).not.toHaveBeenCalled() // 主动关闭 ≠ 手势返回回调

        // 底层仍在，手势返回应收起它
        firePopstate()
        expect(inner).toHaveBeenCalledTimes(1)
    })

    it('嵌套时主动关闭底层（非栈顶）不误弹栈顶哨兵', async () => {
        const inner = vi.fn()
        const outer = vi.fn()
        const disposeInner = pushHistoryGuard(inner)
        pushHistoryGuard(outer)
        // closeStack=[inner, outer]，history 栈顶是 outer 的哨兵
        // 程序化先关底层 inner（如父组件重置 expanded）：不应 back（否则误弹 outer 哨兵）
        disposeInner()
        await flushMicrotasks()
        // guardId 匹配（inner≠outer）→ 不 back，栈顶 outer 哨兵未被误弹
        expect(window.history.back).not.toHaveBeenCalled()
        expect(inner).not.toHaveBeenCalled()
        expect(outer).not.toHaveBeenCalled()
        // 栈顶 outer 仍在，手势返回应正常关它
        firePopstate()
        expect(outer).toHaveBeenCalledTimes(1)
        expect(inner).not.toHaveBeenCalled()
    })

    it('快速重开压了新哨兵：旧 dispose 不误 back 新哨兵（guardId 隔离）', async () => {
        const a = vi.fn()
        const b = vi.fn()
        const disposeA = pushHistoryGuard(a)
        disposeA()
        // 旧 dispose 微任务未跑时，新哨兵压顶（覆盖物快速 close→reopen）
        pushHistoryGuard(b)
        await flushMicrotasks()
        // 旧 dispose 读到新哨兵（guardId 不匹配）→ 不 back，新哨兵留栈顶
        expect(window.history.back).not.toHaveBeenCalled()
        expect(a).not.toHaveBeenCalled()
        expect(b).not.toHaveBeenCalled()
    })

    /**
     * 孤儿哨兵（真机场景：菜单层的 ActionSheet 选中一项后**自己关掉**，同时新 sheet 压了上来）。
     * 已关闭那条的 history entry 没被弹掉，用户返回会停到它上面。曾经这条落点被当成「编号对不上
     * 的 entry」→ 整栈收起（菜单 + 二级弹层一起消失，用户下一次返回就退出页面）。
     */
    it('落点停在「已关闭但 entry 没被弹掉」的哨兵上：只收它之上的层，不整栈收起', async () => {
        const menu = vi.fn()
        const actionSheet = vi.fn()
        const assign = vi.fn()
        pushHistoryGuard(menu)
        const disposeActionSheet = pushHistoryGuard(actionSheet)
        const actionSheetEntryId = topGuardId()
        // 选中菜单项：ActionSheet 自己关掉，同一回调里二级 sheet 压了上来（微任务未跑）
        disposeActionSheet()
        pushHistoryGuard(assign)
        await flushMicrotasks()
        // 旧哨兵没被弹掉（压顶的是新哨兵）→ 它的 history entry 成了孤儿
        expect(window.history.back).not.toHaveBeenCalled()

        // 用户返回：浏览器停在孤儿 entry 上 → 只收起压在它之上的 assign，底下菜单仍在
        firePopstate({ mobiHistoryGuard: true, guardId: actionSheetEntryId })
        expect(assign).toHaveBeenCalledTimes(1)
        expect(menu).not.toHaveBeenCalled()
        expect(actionSheet).not.toHaveBeenCalled()

        // 菜单仍在，用户再返回才收起它（两次返回分别关二级和一级）
        firePopstate()
        expect(menu).toHaveBeenCalledTimes(1)
    })

    /**
     * 认不出的哨兵 entry（HMR 残留 / id 计数器重置）：落点带哨兵标记但 id 不在栈里。
     * findIndex 给的是 -1，曾经被当成合法下标继续走 `closeFrom(index + 1)` = 整栈收起，
     * 且绕过了自弹守卫——自己 back() 弹哨兵那一下就能把所有覆盖物一起收掉。
     */
    it('自弹落到「编号认不出的哨兵 entry」上：不整栈收起', async () => {
        const bottom = vi.fn()
        const top = vi.fn()
        pushHistoryGuard(bottom)
        const disposeTop = pushHistoryGuard(top)

        vi.mocked(window.history.back).mockImplementation(() => {
            window.dispatchEvent(
                new PopStateEvent('popstate', { state: { mobiHistoryGuard: true, guardId: 9999 } }),
            )
        })
        disposeTop()
        await flushMicrotasks()
        expect(top).not.toHaveBeenCalled()
        // 修复前：-1 被当成 index 用 → closeFrom(0) 把底下的覆盖物一起收了
        expect(bottom).not.toHaveBeenCalled()

        // 底层仍在，用户返回照常收起它
        firePopstate()
        expect(bottom).toHaveBeenCalledTimes(1)
    })
})
