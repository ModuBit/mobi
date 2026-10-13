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

/**
 * 移动端弹层层号：**后领的更大 = 后打开的压在先打开的上面**（不分来源）。
 *
 * antd 弹层 z 从 1000 起、shadcn 系弹层整体高过它（基线 = cssVars.ts 的 --mobi-z-overlay
 * 1080，D6）。但两族各自自增会互相盖：菜单（BottomSheet，1080）里长按会话弹出的操作菜单
 * （antd Drawer，1000）就压在菜单**下面**——真机「二级退到后面去了」。故凡是可能叠在别的
 * 移动浮层之上的底部浮层都从这里领号：谁后打开谁在上，与来源无关。
 *
 * **号在打开时领，不在挂载时领**：常驻挂载、按 `open` 开合的 antd Drawer / Modal 若在挂载时
 * 领号，关掉再开会继续用旧号，被后打开的浮层压住（真机：菜单关掉再开，里面的操作菜单又跑到
 * 后面）。BottomSheet 的 Sheet 只在 open 时挂载，天然是「打开时领号」。
 *
 * 层级封顶不设上限：一层占 2 个号（背板 / 主体），同层内主体压在背板上。
 */

/** 一个浮层占两个号：基准 = 背板，基准 + 1 = 主体（见 BottomSheet 的 --sheet-z / --sheet-z-top） */
const STEP = 2
/** 与 core/config/theme/cssVars.ts 的 --mobi-z-overlay 同源（shadcn 弹层整体高于 antd 的 1000 起） */
const LAYER_BASE = 1080

let seq = 0
/** 当前**开着**的浮层数：归零时层号从头开始 */
let live = 0

/**
 * 领一层号（该层的基准值，主体用基准 + 1）。单调递增，**不在这里重置**——同一批里连领
 * 两个号（同一 commit 里嵌套挂载）必须拿到不同的值，重置逻辑放在释放侧（见下）。
 */
export function nextOverlayLayer(): number {
    return LAYER_BASE + ++seq * STEP
}

/**
 * 记一个「开着的浮层」直到关闭 / 卸载，返回释放函数。
 *
 * **全部关掉时层号归零**：号只用来排序「此刻开着的这几层」，单调涨下去迟早会爬过 antd
 * message / notification 的 z（2010 / 2050）——活到几天的 PWA 会话里几百次开合是常态，
 * 那时 toast 会被压在 sheet 后面。归零把值域钉在「同时打开层数」的量级上。
 *
 * 计数挂在 **effect** 上而不是渲染期：StrictMode 会把 effect 跑两遍（挂载→清理→挂载），
 * 以 effect 为准才数得准；渲染期领号、effect 期计数，两侧各自幂等。
 */
export function retainOverlayLayer(): () => void {
    live += 1
    return () => {
        live = Math.max(0, live - 1)
        if (live === 0) seq = 0
    }
}

/**
 * 按 `open` 领号的弹层 z（antd 弹层的 `zIndex` 传它）。
 *
 * 关闭期间返回 undefined（交回 antd 默认值，不参与层序）；每次打开重新领——
 * 见文件头「号在打开时领」。用 ref 在渲染期赋值而不是 useEffect：`open` 翻转的那一帧
 * 就得带上正确层号，晚一帧（effect 在 paint 之后）会先以 antd 默认 z 露一帧，压在
 * 底下的浮层后面闪一下。
 */
export function useOpenOverlayLayer(open: boolean): number | undefined {
    const layer = useRef<number | undefined>(undefined)
    const wasOpen = useRef(false)
    if (open && !wasOpen.current) {
        wasOpen.current = true
        layer.current = nextOverlayLayer()
    } else if (!open && wasOpen.current) {
        wasOpen.current = false
    }
    useEffect(() => (open ? retainOverlayLayer() : undefined), [open])
    return open ? layer.current : undefined
}

/** @internal 测试专用：重置模块级发号状态（生产代码不要调用） */
export function __resetOverlayLayerForTest(): void {
    seq = 0
    live = 0
}
