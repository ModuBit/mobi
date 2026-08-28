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

import { useCallback, useEffect, useRef } from 'react'
import { useUiStore } from '@/core/data/stores/uiStore'

/** 抽屉滑出起步窗口：momentum spring 全程 300ms 的前 ~1/3，让滑出可见起步后再提交路由渲染 */
const MENU_NAVIGATE_HEAD_START_MS = 100

/**
 * 菜单抽屉内导航统一入口：先关抽屉，滑出动画起步后再执行注入的导航闭包。
 *
 * 背景：MobileDrawer 的滑出是主线程 JS spring 动画（逐帧计算），若与 navigate 同拍
 * 提交，会话详情页的渲染风暴（react-query / 消息解密 / Bubble.List / markdown）会
 * 饿死动画帧——表现为「菜单卡在半空，会话页渲染出来一部分才消失」。此处把导航推迟
 * 一个起步窗口（100ms）：滑出可见起步后两者并行推进，动画中后段即使被渲染挤几帧，
 * sheet 已大幅离屏，肉眼无感；总时长与「同拍提交」几乎一致（页面加载本就发生在动画期间）。
 *
 * 参数是调用方的导航闭包（内部用各调用方类型完整的 useNavigate 构造），路由路径 /
 * params 的编译期校验保留在调用点，本 hook 不模仿 navigate 签名、无类型断言。
 * 连续调用为单链重启语义（重启计时器，旧闭包作废）；定时器随 hook 卸载取消，
 * 防止组件树重建后陈旧导航突然生效。
 */
export function useMenuNavigate() {
    const setMobileMenuOpen = useUiStore((s) => s.setMobileMenuOpen)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // 卸载清理：尚未触发的延迟导航随组件消失作废
    useEffect(() => () => {
        if (timerRef.current != null) clearTimeout(timerRef.current)
    }, [])

    return useCallback((go: () => void) => {
        setMobileMenuOpen(false)
        // 单链重启：前一次延迟未触发就被本次覆盖（快速连点不同会话行时
        // 只执行最后一次，且旧定时器不会成为不可取消的孤儿）
        if (timerRef.current != null) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
            timerRef.current = null
            go()
        }, MENU_NAVIGATE_HEAD_START_MS)
    }, [setMobileMenuOpen])
}
