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
 * 浮层的「可否决关闭」契约：**先通知后决定**的记账一次收在这里。
 *
 * 关闭是**同步通知**上游的（`onClose` / `requestCancel`），上游在同一拍里决定收不收。
 * 本 hook 负责拍子与记账，收不收的**语义**仍归使用方（沉到哪、通知谁）：
 *
 * 1. **两拍否决检测**：首拍覆盖同步消费者，宽限拍（`VETO_GRACE_MS`）覆盖短异步消费者
 *    （`startTransition` / 一次 `await`）。两拍之后上游仍开着 = 被否决 → `onVetoed`。
 *    单看首拍会把「已接受」误判成「被否决」——React 的 setState 到 DOM 生效要跨一次提交。
 * 2. **连点防重入**：宽限窗口内的第二次关闭会再排一条检测链，旧链回调先置空句柄会 clobber
 *    新链，两条链先后触发 → 双份沉降 + 双份重臂。作废旧链只留最后一条。
 * 3. **哨兵消费记账**：手势返回发起的关闭已被 popstate 拿走哨兵，若又被否决，栈上就少了
 *    这一层，下一次返回会穿透到路由层（Android Chrome 上表现为直接退出 PWA）——所以要
 *    `guardEpoch` 重臂。仅「确实被消费」才重臂：下拉 / 点遮罩 / ESC 发起的关闭被否决时
 *    哨兵还在栈上，再推一条只是多压一层 entry。
 * 4. **释放速度暂存**：关闭是「先通知后动画」，父组件 setState 翻转 open 要一拍才触发滑出，
 *    速度经此传递、由退场动画 `takeVelocity()` 取走（非手势路径为 undefined）。
 *
 * 两个使用方（BottomSheet / 画板载体）原本各抄一份，注释互相声明「同值同义」——契约一旦
 * 改动要手工同步两处，且第一份分叉已经出现（timer 句柄类型、重臂条件各自的写法）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 否决检测的第二拍宽限（ms）：首拍之后 open 仍为真时再等这一窗口，仍真才判定否决。
 * 覆盖 `startTransition` / 短异步消费者（见模块文档第 1 条）。
 */
export const VETO_GRACE_MS = 100

export interface VetoableClose {
    /**
     * 请求关闭。**调用方在此之前通知上游**（`onClose(...)` / `requestCancel()`）——通知是
     * 使用方的语义，本 hook 只从这一拍开始记账。`velocity` 为手势释放速度（可省）。
     */
    request: (velocity?: number) => void
    /** 手势返回回调里调：标记「本次关闭由 popstate 发起，哨兵已被消费」（决定否决后是否重臂） */
    markGuardConsumed: () => void
    /** 退场路径取走暂存速度（**取走即清空**，防陈旧速度被下一次关闭复用）；不需要速度的分支也调它丢弃 */
    takeVelocity: () => number | undefined
    /** 重臂纪元：原样透给 `useHistoryGuard` 的第三个参数（变化即重推哨兵） */
    guardEpoch: number
}

/**
 * @param open 上游「是否仍要它开着」（关闭被接受后它会翻假；AnimatePresence 之类会在
 *             组件仍播退场动画时就把 presence 翻假，所以必须读最新值而非闭包捕获）
 * @param onVetoed 关闭被否决：使用方在此把浮层沉回它该在的位置（原位 / 当前档位）
 */
export function useVetoableClose({ open, onVetoed }: {
    open: boolean
    onVetoed: (velocity?: number) => void
}): VetoableClose {
    const openRef = useRef(open)
    openRef.current = open

    const onVetoedRef = useRef(onVetoed)
    onVetoedRef.current = onVetoed

    /** 否决检测定时器：请求接管 / 卸载时统一作废（防对已卸载的浮层沉降） */
    const vetoTimerRef = useRef<number | null>(null)
    /** 哨兵已被 popstate 消费（本次关闭由手势返回发起） */
    const guardConsumedRef = useRef(false)
    const [guardEpoch, setGuardEpoch] = useState(0)
    /** 手势释放速度暂存（关闭「先通知后动画」，速度经此传递到退场） */
    const velocityRef = useRef<number | null>(null)

    const scheduleVetoCheck = useCallback(function schedule(delayMs: number): number {
        return window.setTimeout(() => {
            vetoTimerRef.current = null
            if (!openRef.current) {
                // 关闭被接受：本轮的哨兵记账到此为止（哨兵已归这一层，不再重臂）
                guardConsumedRef.current = false
                return
            }
            if (delayMs === 0) {
                vetoTimerRef.current = schedule(VETO_GRACE_MS)
                return
            }
            // 沉降即消费掉暂存速度，防陈旧速度被后续关闭复用
            const velocity = velocityRef.current ?? undefined
            velocityRef.current = null
            onVetoedRef.current(velocity)
            if (guardConsumedRef.current) setGuardEpoch((epoch) => epoch + 1)
            guardConsumedRef.current = false
        }, delayMs)
    }, [])

    const request = useCallback((velocity?: number) => {
        velocityRef.current = velocity ?? null
        if (vetoTimerRef.current !== null) {
            window.clearTimeout(vetoTimerRef.current)
            vetoTimerRef.current = null
        }
        vetoTimerRef.current = scheduleVetoCheck(0)
    }, [scheduleVetoCheck])

    const markGuardConsumed = useCallback(() => { guardConsumedRef.current = true }, [])

    const takeVelocity = useCallback(() => {
        const velocity = velocityRef.current
        velocityRef.current = null
        return velocity ?? undefined
    }, [])

    // 卸载清理：作废未触发的检测链（否则会对着已卸载的浮层沉降）
    useEffect(() => () => {
        if (vetoTimerRef.current !== null) window.clearTimeout(vetoTimerRef.current)
    }, [])

    return { request, markGuardConsumed, takeVelocity, guardEpoch }
}
