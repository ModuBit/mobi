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
import { useNavigate } from '@tanstack/react-router'
import { useUiStore } from '@/core/data/stores/uiStore'

/** 抽屉滑出起步窗口：momentum spring 全程 300ms 的前 ~1/3，让滑出可见起步后再提交路由渲染 */
const MENU_NAVIGATE_HEAD_START_MS = 100

/**
 * 菜单抽屉内导航统一入口：先关抽屉，滑出动画起步后再导航。
 *
 * 背景：MobileDrawer 的滑出是主线程 JS spring 动画（逐帧计算），若与 navigate 同拍
 * 提交，会话详情页的渲染风暴（react-query / 消息解密 / Bubble.List / markdown）会
 * 饿死动画帧——表现为「菜单卡在半空，会话页渲染出来一部分才消失」。此处把导航推迟
 * 一个起步窗口（100ms）：滑出可见起步后两者并行推进，动画中后段即使被渲染挤几帧，
 * sheet 已大幅离屏，肉眼无感；总时长与「同拍提交」几乎一致（页面加载本就发生在动画期间）。
 *
 * 参数与 useNavigate 完全同形（透传），调用点零学习成本。定时器随 hook 卸载取消，
 * 防止组件树重建后陈旧导航突然生效。
 */
export function useMenuNavigate() {
    const navigate = useNavigate()
    const setMobileMenuOpen = useUiStore((s) => s.setMobileMenuOpen)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // 卸载清理：尚未触发的延迟导航随组件消失作废
    useEffect(() => () => {
        if (timerRef.current != null) clearTimeout(timerRef.current)
    }, [])

    return useCallback(((...args: unknown[]) => {
        setMobileMenuOpen(false)
        timerRef.current = setTimeout(() => {
            timerRef.current = null
            // navigate 是泛型重载函数，Parameters<> 只能捕获到错误的签名形态；
            // 边界处经 unknown 转发运行时参数，对外仍暴露完整类型的 navigate 签名，
            // 调用点的路由路径 / params 校验不受影响
            ;(navigate as (...a: unknown[]) => void)(...args)
        }, MENU_NAVIGATE_HEAD_START_MS)
    }) as typeof navigate, [navigate, setMobileMenuOpen])
}
