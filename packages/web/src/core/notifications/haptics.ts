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
 * 触觉反馈（Vibration API）单源：pattern 常量 + 统一入口。
 *
 * 短轻柔原则（2026-11-11）：所有 pattern 都是「短震」形态——单段震动 ≤30ms，
 * 与系统级触觉反馈（touch haptics）同量级，不做长震/重震。
 *
 * 平台约束（决定了各消费方的分工）：
 * - 仅 Android Chrome 实现 navigator.vibrate；iOS Safari（含主屏 PWA）无此 API，
 *   本模块所有入口静默早退，界面行为不受影响
 * - Chrome 要求 sticky user activation（页面被点过才允许震），且页面 hidden
 *   （切走/锁屏）时直接 block——后台提醒的震动因此由 SW 系统通知的 vibrate
 *   字段承担（系统通知通道不受该限制），本模块只负责前台场景
 * - Android 系统勿扰/专注模式会拦截 Vibration API（2026-11-11 真机实测），
 *   属系统级行为，应用层无法绕过
 * - 桌面端通常无振动器，调用返回 false，静默无害
 */

/**
 * 震动开关读取器（注入式）：notifications 层不直接认识 uiStore（避免把 store/
 * i18n 初始化拖进一切引用方的模块加载链），app 入口（main.tsx）安装时注入读取。
 * 默认放行——未注入（纯函数测试等）视为开启。
 */
let hapticGate: () => boolean = () => true

export function setHapticGate(read: () => boolean): void {
    hapticGate = read
}

/** 反馈 pattern（毫秒，[震,停,震...]）。语义与 attentionFeedback 的声音方向对偶 */
export const HAPTIC_PATTERNS = {
    /** 按钮点击：极短一触 */
    tap: [10],
    /** turn 完成（ready）：单次轻点，落定感 */
    ready: [20],
    /** 等待审批/提问（pending）：双脉冲，比 ready 略急（需要你行动） */
    pending: [30, 60, 30],
} as const

export type HapticPatternName = keyof typeof HAPTIC_PATTERNS

/**
 * 按给定 pattern 触发一次震动。
 * 用户关闭震动反馈（设置页开关，经 setHapticGate 注入读取）时直接跳过——gate 在此
 * 统一生效，页面层一切调用（委托/turn 反馈/试一下）自动跟随。
 * @returns 请求是否被环境接受（开关关闭/API 缺失/被拦截/抛错都算 false；调用方无需感知）
 */
export function vibratePattern(pattern: readonly number[]): boolean {
    if (!hapticGate()) return false
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false
    try {
        // 展开拷贝：readonly pattern 满足 vibrate 的可变数组签名，同时防止实现方改写入参
        return navigator.vibrate([...pattern])
    } catch {
        // 某些环境 vibrate 存在但调用抛错（权限/无振动器），静默
        return false
    }
}

/** 按钮点击触觉反馈：按下即一触（与 Android 原生 touch haptics 同时机） */
export function hapticTap(): void {
    vibratePattern(HAPTIC_PATTERNS.tap)
}

/** 设备/浏览器是否具备 Vibration API（不代表有振动器；「试一下」的降级提示判据） */
export function vibrateSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

/**
 * 带交互语义的元素 selector：button 本体 + ARIA 交互角色 + 原生 checkbox/radio。
 * antd（Switch/Checkbox/Segmented/Pagination）、Radix/Base UI（Select/Combobox/DropdownMenu）、
 * 自管 uiarc 件的 DOM 都带其中之一——委托命中即覆盖，新组件无需逐个接入。
 * 注意 summary 不在内：折叠头属展开收起语义（真机反馈此类不震），同 aria-expanded 排除。
 */
const HAPTIC_TARGET_SELECTOR = [
    'button',
    '[role="button"]',
    '[role="combobox"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="option"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="treeitem"]',
    'input[type="checkbox"]',
    'input[type="radio"]',
].join(',')

let hapticsInstalled = false

/**
 * 全局「按下即震」：document capture 阶段委托 pointerdown，命中可交互元素就 tap 一下。
 *
 * 为什么是全局委托而非逐组件挂载（2026-11-11 真机反馈后重构）：
 * - 逐组件挂载覆盖不全（antd/Radix 内部 DOM 挂不到），select/switch/tab 等没震感
 * - 组件层 + 局部叠加会出现一次点击两次调用（「试一下」曾 pointerdown tap + click
 *   测试 pattern 叠成「震两下」）；委托单点消费，一次按下至多一触
 * - capture 阶段先于 React 合成事件，消费方 handler 与震动互不干扰
 * 不震的三类：不可交互态（disabled / aria-disabled / aria-busy）；展开收起语义
 * （带 aria-expanded 的元素——分组折叠头等，此类高频且无确认价值，真机反馈不要震）；
 * 用户关闭震动反馈（uiStore.hapticFeedbackEnabled，在 vibratePattern 内统一 gate）。
 */
export function installHapticFeedback(): void {
    if (hapticsInstalled || typeof document === 'undefined') return
    hapticsInstalled = true
    document.addEventListener('pointerdown', (e) => {
        const target = e.target
        if (!(target instanceof Element)) return
        const el = target.closest<HTMLElement>(HAPTIC_TARGET_SELECTOR)
        if (!el) return
        if (el.hasAttribute('disabled')) return
        if (el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-busy') === 'true') return
        // 展开收起（分组折叠头/树展开行）：高频且状态本身可视，按下不震（2026-11-11 真机反馈）。
        // combobox 的 aria-expanded 是自身弹层开合语义而非区域展开收起——用户点名 select 要震，不排除
        if (el.hasAttribute('aria-expanded') && el.getAttribute('role') !== 'combobox') return
        hapticTap()
    }, { capture: true })
}
