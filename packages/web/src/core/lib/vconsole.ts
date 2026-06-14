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
 * 移动端调试面板（vConsole）的按需加载工具
 *
 * 启用策略：
 * - **移动端**：在 NewSessionPage 连点品牌 Icon ≥5 次开启（隐蔽入口）
 * - **桌面端**：不开启（有原生 devtools console）
 *
 * 临时开启：仅当前页面会话有效，刷新或关闭页面后自动消失，需重新连点。
 * vconsole 通过动态 import 按需加载，未开启时不进入 bundle。
 */

/** 防止重复初始化 */
let initialized = false

/**
 * 是否为移动端设备（主输入为触屏，pointer: coarse）
 * 用 pointer 而非屏幕宽度判断：PC 鼠标为 fine 不匹配，
 * 避免 PC 窄窗口 / Chrome 模拟器（窄 viewport）被误判为移动端
 */
export function isMobileDevice(): boolean {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(pointer: coarse)').matches
}

/**
 * 初始化 vConsole 调试面板（幂等，多次调用只初始化一次）
 */
export async function initVConsole(): Promise<void> {
    if (initialized) return
    if (typeof window === 'undefined') return
    initialized = true
    try {
        const { default: VConsole } = await import('vconsole')
        new VConsole()
    } catch (err) {
        // 加载失败允许后续重试
        initialized = false
        console.error('[vconsole] 初始化失败', err)
    }
}

/**
 * 开启 vConsole（移动端连点品牌 Icon 触发）
 * 桌面端忽略；仅当前会话有效，刷新后失效
 */
export function enableVConsole(): void {
    if (!isMobileDevice()) return
    void initVConsole()
}
