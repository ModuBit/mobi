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

import { useCallback } from 'react'
import { useUiStore } from '@/core/data/stores/uiStore'

/**
 * 菜单抽屉内导航统一入口：先关抽屉，**等抽屉完全离场（DOM 卸载）后**再提交路由渲染。
 *
 * 为什么不能提前提交：底部 sheet 的滑出是主线程 JS spring（逐帧计算），而目标会话页的首次
 * 渲染是同一根主线程上的长任务（真机/20x 降速实测单帧 4.5s）。两者重叠时动画只能停在
 * 冻结的那一帧上——真机表现是「菜单收到一半卡在半空，过一会儿页面才切过去」（2026-10-21
 * CDP 采样实锤：点击 → 100ms 后导航 → 4.5s 长任务 → sheet 停在滑出 72% 处数秒）。
 *
 * 历史：早先用「固定 100ms 起步窗口」让导航与动画重叠，目的是不让页面加载干等动画；
 * 但只要渲染风暴比起步窗口长（真机必长），冻结就必然发生。现在改为**事件驱动**：
 * 关抽屉 → sheet 滑出落定卸载 → 取走并执行导航（见 MobileMenuDrawer 的 onExited）。
 * 代价是切换晚一个滑出时长，换掉的是「半截抽屉挂在屏幕上」。
 *
 * 参数是调用方的导航闭包（内部用各调用方类型完整的 useNavigate 构造），路由路径 /
 * params 的编译期校验保留在调用点，本 hook 不模仿 navigate 签名、无类型断言。
 * 连续调用为覆盖语义（只保留最后一次闭包）；闭包存在 store 里而不是 hook 实例上，
 * 因为它要在发起它的组件（菜单内容）卸载之后才执行。
 */
export function useMenuNavigate() {
    const requestMenuNavigation = useUiStore((s) => s.requestMenuNavigation)

    return useCallback((go: () => void) => {
        requestMenuNavigation(go)
    }, [requestMenuNavigation])
}
