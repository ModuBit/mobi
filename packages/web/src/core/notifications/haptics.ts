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

/**
 * gate 查询包装：页面层走「不经 vibratePattern 的震动通道」前自查（SW 系统通知的
 * vibrate 字段由 SW 消费，gate 拦不到）——开关判定仍单源在本模块。
 */
export function hapticsEnabled(): boolean {
    return hapticGate()
}

/** 反馈 pattern（毫秒，[震,停,震...]）。语义与 attentionFeedback 的声音方向对偶 */
export const HAPTIC_PATTERNS = {
    /** 按钮点击：极短一触 */
    tap: [10],
    /** 危险/有后果的确认（删除等）：双脉冲，比 tap 明显（Material 的 confirm 语义） */
    confirm: [15, 40, 15],
    /** 手势识别成功（长按生效/边缘滑越过判定线）：双脉冲慢节奏，与 tap 的单触区分——
     *  手势无视觉预兆，震动是唯一确认通道，需要「这不是一次普通点击」的辨识度 */
    gesture: [15, 80, 15],
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

/** 手势确认触觉反馈：长按生效 / 边缘滑越过判定线（与 tap 区分的双脉冲慢节奏） */
export function hapticGesture(): void {
    vibratePattern(HAPTIC_PATTERNS.gesture)
}

/**
 * 带交互语义的元素 selector：button 本体 + ARIA 交互角色 + 原生 checkbox + 显式声明。
 * antd（Checkbox/Pagination）、Radix/Base UI（Select/Combobox/DropdownMenu）、
 * 自管 uiarc 件的 DOM 都带其中之一——委托命中即覆盖，新组件无需逐个接入。
 *
 * 刻意不在内（2026-11-11 真机反馈 + 打扰面收窄）：
 * - summary / aria-expanded：展开收起语义（分组折叠头/树展开不震），豁免判据看
 *   「有 aria-expanded 且无 aria-haspopup」——combobox/select 的展开是弹层语义
 *   （带 aria-haspopup），按下要震
 * - role="switch"：状态切换控件，反馈由 onChange 按新状态决定（反馈开关即时示范）
 * - [role="tab"] / [role="option"] / [role="menuitem"] 系：高频导航/选择，
 *   每次都震是最大打扰源；视觉高亮已是即时反馈
 * - input[type="radio"]（antd Segmented/RadioGroup 底座）：同高频理由；
 *   [role="radio"] 在列（离散确认动作，与 checkbox 一致——AskUserQuestion 单选项要震，
 *   antd 系的 input 底座不受影响）
 */
const HAPTIC_TARGET_SELECTOR = [
    'button',
    '[role="button"]',
    '[role="combobox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="treeitem"]',
    'input[type="checkbox"]',
    '[data-haptic]',
].join(',')

/** 命中后仍排除的元素：switch（button+role 形态，selector 层躲不开 button） */
function isExcludedHit(el: HTMLElement): boolean {
    return el.getAttribute('role') === 'switch'
}

/**
 * 命中元素声明的 pattern：`data-haptic="confirm"` → 危险确认（双脉冲），
 * 缺省 → tap。给「有后果的操作」留一个声明通道（如 Button danger 自动携带），
 * 委托层不感知业务语义。
 */
function resolveHapticPattern(el: HTMLElement): readonly number[] {
    return el.closest<HTMLElement>('[data-haptic="confirm"]')
        ? HAPTIC_PATTERNS.confirm
        : HAPTIC_PATTERNS.tap
}

let hapticsInstalled = false

/** touch/pen 按下的震动确认延迟：窗口内出现滚动/拖拽意图则取消（防滚动误震） */
const TOUCH_HAPTIC_DELAY_MS = 80
/** 视为滚动/拖拽开始的位移阈值（slop；越过即取消按下震动） */
const HAPTIC_MOVE_SLOP_PX = 8

/** touch 延迟确认的挂起条目（mouse 即刻震不经过这里） */
let touchPending: {
    timer: ReturnType<typeof setTimeout>
    fire: () => void
    x: number
    y: number
    pointerId: number
} | null = null

function cancelTouchPending(): void {
    if (!touchPending) return
    clearTimeout(touchPending.timer)
    touchPending = null
}

/**
 * 全局「按下即震」：document capture 阶段委托 pointerdown，命中可交互元素就 tap 一下。
 *
 * 为什么是全局委托而非逐组件挂载（2026-11-11 真机反馈后重构）：
 * - 逐组件挂载覆盖不全（antd/Radix 内部 DOM 挂不到），select/switch/tab 等没震感
 * - 组件层 + 局部叠加会出现一次点击两次调用（「试一下」曾 pointerdown tap + click
 *   测试 pattern 叠成「震两下」）；委托单点消费，一次按下至多一触
 * - capture 阶段先于 React 合成事件，消费方 handler 与震动互不干扰
 * 不震的三类：不可交互态（disabled / aria-disabled / aria-busy）；展开收起语义
 * （有 aria-expanded 且无 aria-haspopup 的元素——分组折叠头等，此类高频且无确认价值，
 * 真机反馈不要震；combobox/select 的展开带 aria-haspopup，是弹层语义不豁免）；
 * 用户关闭震动反馈（uiStore.hapticFeedbackEnabled，在 vibratePattern 内统一 gate）。
 * touch/pen 延迟确认（防滚动误震）：pointerdown 后短窗口内出现位移（滚动/拖拽）、
 * scroll 或 pointercancel 则取消；窗口内 pointerup（快速 tap）提前触发；
 * mouse 无滚动歧义，按下即刻震。
 */
export function installHapticFeedback(): void {
    if (hapticsInstalled || typeof document === 'undefined') return
    hapticsInstalled = true
    document.addEventListener('pointerdown', (e) => {
        const target = e.target
        if (!(target instanceof Element)) return
        const el = target.closest<HTMLElement>(HAPTIC_TARGET_SELECTOR)
        if (!el) return
        if (isExcludedHit(el)) return
        if (el.hasAttribute('disabled')) return
        if (el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-busy') === 'true') return
        // 展开收起（分组折叠头/树展开行）：高频且状态本身可视，按下不震（2026-11-11 真机反馈）。
        // combobox/select 的 aria-expanded 带 aria-haspopup（弹层语义而非区域展开收起）——不豁免
        if (el.hasAttribute('aria-expanded') && !el.hasAttribute('aria-haspopup')) return
        const fire = () => vibratePattern(resolveHapticPattern(el))
        if (e.pointerType === 'mouse') {
            fire()
            return
        }
        // touch/pen：延迟确认（防滚动误震——手指落在列表行上开始滚动不该震）
        cancelTouchPending()
        touchPending = {
            timer: setTimeout(() => { touchPending = null; fire() }, TOUCH_HAPTIC_DELAY_MS),
            fire,
            x: e.clientX,
            y: e.clientY,
            pointerId: e.pointerId,
        }
    }, { capture: true })

    // touch 延迟确认的取消/提前触发监听（与 pointerdown 同批安装，一次即可）
    document.addEventListener('pointermove', (e) => {
        const p = touchPending
        if (!p || e.pointerId !== p.pointerId) return
        // 位移越过 slop = 滚动/拖拽开始，取消按下震动
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > HAPTIC_MOVE_SLOP_PX) cancelTouchPending()
    }, { capture: true })
    document.addEventListener('pointerup', (e) => {
        const p = touchPending
        if (!p || e.pointerId !== p.pointerId) return
        cancelTouchPending()
        p.fire()
    }, { capture: true })
    document.addEventListener('pointercancel', cancelTouchPending, { capture: true })
    // 任何容器开始滚动（触摸滚动在 pointermove 之前可能直接发 scroll）都取消
    window.addEventListener('scroll', cancelTouchPending, { capture: true, passive: true })
}
