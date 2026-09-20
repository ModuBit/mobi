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

import { useEffect, useRef } from 'react'

/** 默认防抖时长：等系统选择手柄拖拽稳定后再判定（移动端长按起选后 selectionchange 连发） */
const DEFAULT_DEBOUNCE_MS = 300

export interface UseMobileQuoteSelectionOptions {
    /** 仅移动端启用（PC 走 mouseup 路径，两者互斥） */
    enabled: boolean
    /** 落定防抖时长（ms） */
    debounceMs?: number
    /** 选区落定回调：携带非空（非 collapsed）选区的 Range；空选区不回调 */
    onSelectionSettled: (range: Range) => void
}

/**
 * 移动端选区引用入口的 DOM 监听薄壳（spec「移动端手势仲裁」票 07）：
 *
 * 移动端没有可靠的 mouseup 语义（长按起选后手指已抬起，时序不定），改听 document 级
 * `selectionchange`。选区变化后防抖（等系统选择手柄稳定），落定时选区非空才回调——
 * 判定（能否引用）交给容器层的选区判定器 resolveQuoteSelection，本 hook 不做任何业务裁决。
 *
 * 与容器既有「浮层开着时选区清空即关浮层」effect 的分工：关闭语义（collapsed）归
 * 既有 effect，本 hook 只负责「落定的非空选区 → 提案」，两侧互不重叠；防抖同时
 * 吸收了「先清后选」的连发抖动，不会在拖拽手柄过程中反复弹层。
 */
export function useMobileQuoteSelection({ enabled, debounceMs = DEFAULT_DEBOUNCE_MS, onSelectionSettled }: UseMobileQuoteSelectionOptions): void {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // 回调经 ref 透传：调用方传入的通常是非稳定引用（inline 闭包），不重挂监听
    const onSelectionSettledRef = useRef(onSelectionSettled)
    onSelectionSettledRef.current = onSelectionSettled

    useEffect(() => {
        if (!enabled) return
        const handleSelectionChange = () => {
            // 连发重置：只在最后一次变化后 debounceMs 静默期才落定
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => {
                timerRef.current = null
                const sel = window.getSelection()
                const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
                // 空选区（未起选/已清）不回调：关闭归容器既有 effect，避免双重开合逻辑
                if (range && !range.collapsed) onSelectionSettledRef.current(range)
            }, debounceMs)
        }
        document.addEventListener('selectionchange', handleSelectionChange)
        return () => {
            document.removeEventListener('selectionchange', handleSelectionChange)
            // 卸载清残留定时器：enabled 翻转（断点跨移动端阈值）后不得再回调
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [enabled, debounceMs])
}
