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

import { useSyncExternalStore } from 'react'

/** 键盘视为弹出的最小 inset（px）：真机键盘高度 ≥150，URL 栏伸缩的抖动远小于此 */
const KEYBOARD_INSET_THRESHOLD = 80

/** overlay 模式腾出动画的时长（ms）：Android 系统键盘滑出 ~300ms，腾出与其衔接（略短，
 *  让布局先于键盘尾段落定）。store 只在事件时刻写一次终值，插值完全由消费端的 CSS
 *  transition 承担——时长与曲线经 --kb-anim 单源下发给所有消费端（不再各写一份），
 *  本常量同时是可见性保护的沉降等待 */
const OVERLAY_ANIM_MS = 280

/** 腾出动画的 CSS 变量名（写 <html> 上）：消费端一律 `transition: … var(--kb-anim)`，
 *  调时长/曲线只改本模块 */
export const KB_ANIM_CSS_VAR = '--kb-anim'
const KB_ANIM_TRANSITION = `${OVERLAY_ANIM_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`

/**
 * 当前是否 overlay 键盘模式（与内部双源判定读同一权威 flag）。
 * 消费端据此决定 inset 变化怎么跟：overlay 模式下 store 只写终值，需 CSS 过渡插值；
 * resize 模式下 inset 由 visualViewport 的 resize/scroll 逐次写入，再叠过渡只会让
 * 元素始终落后键盘一截（拖尾/抖动）。
 */
export function isKeyboardOverlayMode(): boolean {
    const vk = (navigator as { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard
    return vk?.overlaysContent === true
}

/** focusin 预测弹出后等待 geometrychange 确认的窗口（ms）：超时未见确认视为假弹
 *  （外接键盘/平板等不会弹软键盘的场景），预测收回 */
const PREDICT_CONFIRM_MS = 700

/** 输入焦点切换（A→B 连发 focusout/focusin）的宽限（ms）：期内 focusin 则取消收起 */
const FOCUS_SWITCH_GRACE_MS = 100

/** 腾出动画沉降后再执行聚焦元素滚入可视位的余量（ms） */
const SCROLL_SETTLE_MS = 60

export interface KeyboardViewport {
    /** 相对完整视口的键盘高度（基线 − 可视高）：「键盘是否弹出」的判定与 ghost 隐藏判据 */
    keyboardInset: number
    /** 当前 layout viewport 内被键盘占据的高度（innerHeight − 可视高）：fixed 元素的
     *  bottom 补偿——resize 模式下它 ≈ 0（layout viewport 已缩到键盘上方），iOS 模型下
     *  ≈ keyboardInset，直接用 keyboardInset 会在 Android 上把浮层抬出屏幕 */
    layoutInset: number
}

/** 布局消费的 CSS 变量名（写 <html> 上）：overlay 模式的逐帧 inset */
export const KB_INSET_CSS_VAR = '--kb-inset'

/**
 * 虚拟键盘占据底部的高度（0 = 键盘未弹出/无 visualViewport）。
 *
 * 关键陷阱（2026-09-23 真机实测）：Android resize 模式下 **layout viewport 本身缩到
 * 键盘上方**，innerHeight 已变小且 ≈ vv.height，`innerHeight − vv` 恒为 0——键盘
 * 测不出来。基线必须用**历史最大可视高度**：inset = 基线 − 当前可视高度。
 *
 * 基线跟随策略（棘轮教训）：基线**只升不降不可行**——桌面浏览器缩放恢复、移动端
 * URL 栏展开回落都是「innerHeight 变小 ≥ 阈值」的环境变化，会被永久误判为键盘。
 * 键盘与环境的唯一可靠区别是**焦点**：键盘只因输入焦点而弹出。故焦点在可编辑元素
 * 时基线只上调（保留键盘弹出前的最大值），无焦点时基线双向跟随当前环境（棘轮可逆）。
 * 焦点事件先于键盘 resize（键盘因焦点而弹），update 触发时判据已就位。
 *
 * visualViewport 的 scroll/resize 在移动端滚动、地址栏伸缩、捏合缩放期间连发，
 * 而键盘值只在跨越阈值时才变——store 写入前做值比对，值未变不通知订阅者。
 *
 * 双源模式（2026-10-31 键盘平滑动画；2026-11-01 性能重构为纯 CSS 插值）：
 * - **overlay 模式**（index.html 早期脚本对支持面浏览器设 overlaysContent=true，Android
 *   Chrome/PWA）：浏览器不再收缩视口，键盘浮在内容上。**真机实锤（2026-10-31 CDP 逐帧
 *   采样）：Chromium 不逐帧透传键盘几何——geometrychange 与 env(keyboard-inset-*) 只在
 *   键盘滑动动画结束后以终值集中触发**，布局无从跟随滑动过程。故 store 在事件时刻写
 *   **一次终值**，插值全部交给消费端 CSS transition（`--kb-inset` 一跳，浏览器逐帧插值
 *   padding/bottom）。曾经用 rAF 逐帧写变量自补动画，真机实测全页掉帧：每帧 rAF JS +
 *   React 逐帧通知 + 每帧 resize 广播风暴（虚拟化列表等监听者全量重算）+ padding 每帧
 *   变引发整棵布局树逐帧 reflow——四项叠加远超帧预算，且后两项 CSS transition 同样要
 *   付出，前三项纯属徒增。事件驱动后 JS 每次键盘周期只跑几行：
 *   - **focusin 预测**：可编辑元素聚焦即预判键盘将弹，立刻写入「记忆高度」（上次
 *     geometrychange 终值）——transition 与键盘滑动同步开始；假弹（外接键盘等）超过确认
 *     窗口未见 geometrychange 则写 0 收回
 *   - **geometrychange 校正**：终值到达后写真值（与预测一致时计算值不变、transition
 *     不受扰动；不一致时 transition 从当前插值位自动重定向到新值）
 *   - **focusout 预测收起**：焦点离开即写 0（切换输入框的连发由宽限期吸收）；键盘被
 *     手势收起而焦点仍在的场景由 geometrychange(0) 兜底
 *   - 若未来 Chromium 开始逐帧透传几何，每帧 geometrychange 写变量即自动退化为精确跟随
 * - **vv 模式**（无 VirtualKeyboard API：iOS/Firefox）：既有 resizes-content/视觉视口
 *   数学原样保留——iOS 的 vv.height 在键盘动画期间由系统逐帧更新，天然平滑，不插值；
 *   `--kb-inset` 在该模式下恒缺省（fallback 0px），布局回落视口收缩路径
 *
 * 外部 store + selector 订阅（code-review 2026-10-31）：键盘事件会更新 store，若整页
 * 组件（ChatContainer）经 hook state 承接就会连带重渲染。消费方按需订阅派生原值——
 * 页级组件只订 `inset > 0` 布尔（整个键盘周期重渲染 2 次），数值订阅只剩
 * QuoteCommentInput 这类小浮层（终值一跳 + 自身 CSS transition 跟随）。
 */
/** VirtualKeyboard API 形状子集（lib.dom 未收录，只取消费面） */
interface VirtualKeyboardLike {
    /** overlay 模式开关（index.html 早期脚本设 true）；分支判定读它而非 API 存在性 */
    overlaysContent: boolean
    boundingRect: { height: number }
    addEventListener(type: 'geometrychange', listener: () => void): void
    removeEventListener(type: 'geometrychange', listener: () => void): void
}
/** 当前焦点是否在可编辑元素（键盘弹出的前提；INPUT/TEXTAREA/contenteditable 覆盖全部输入面） */
function isEditableFocus(): boolean {
    return isEditableElement(document.activeElement)
}
function isEditableElement(el: Element | null): boolean {
    if (!(el instanceof HTMLElement)) return false
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
}
/** 元素是否视觉可见且可聚焦（scrollIntoView 保护的判据）：蜜罐（visibility:hidden）、
 *  折叠卡片（祖先 hidden）、xterm 捕获层（opacity:0）都排除，滚它们只会乱页。
 *  只读 computed style 不读 rect——jsdom 无布局引擎，rect 恒 0 会误杀测试 */
function isVisuallyFocusable(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return false
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.visibility === 'hidden' || style.display === 'none') return false
        if (node === el && Number(style.opacity) === 0) return false
    }
    return true
}

// ── 模块级单源 store（全局唯一键盘几何；事件监听按订阅者计数启停） ─────────────

let storeState: KeyboardViewport = { keyboardInset: 0, layoutInset: 0 }
const storeListeners = new Set<() => void>()
/** 当前事件监听的拆除器（watcher 启停单源；null = 未挂监听） */
let stopWatchers: (() => void) | null = null
let watcherRefs = 0

function storeUpdate(next: KeyboardViewport): void {
    if (next.keyboardInset === storeState.keyboardInset && next.layoutInset === storeState.layoutInset) return
    storeState = next
    for (const listener of storeListeners) listener()
}

function storeSubscribe(listener: () => void): () => void {
    storeListeners.add(listener)
    watcherRefs += 1
    if (watcherRefs === 1) stopWatchers = startWatchers()
    return () => {
        storeListeners.delete(listener)
        watcherRefs -= 1
        if (watcherRefs === 0 && stopWatchers) {
            stopWatchers()
            stopWatchers = null
        }
    }
}

// ── overlay 终值写入（事件时刻一跳；平滑由消费端 CSS transition 承担） ────────

/** 上次 geometrychange 报告的真值（focusin 预测的目标高度） */
let lastKnownKeyboardHeight = 0
/** 预测弹出后是否已被 geometrychange 确认（假弹回退判据） */
let predictConfirmed = false
let predictTimer: ReturnType<typeof setTimeout> | null = null
let focusOutTimer: ReturnType<typeof setTimeout> | null = null
/** 聚焦元素滚入可视位的延迟执行器（腾出动画沉降后） */
let scrollIntoViewTimer: ReturnType<typeof setTimeout> | null = null

/** 把终值落到 store 与 CSS 变量（两消费面同源）：store 数值订阅者（小浮层）瞬跳后由
 *  自身 transition 跟随，布局消费端（padding/bottom 的 transition）由浏览器插值。并广播
 *  一次 resize——morph 弹层等锚定浮层只监听 scroll/resize 重算位置，布局因键盘腾出
 *  （无 scroll 事件）时靠它跟随；终值帧一次即可，逐帧广播曾是掉帧元凶之一 */
function commitInset(px: number): void {
    const rounded = Math.round(px)
    if (rounded === storeState.keyboardInset) return
    storeUpdate({ keyboardInset: rounded, layoutInset: rounded })
    document.documentElement.style.setProperty(KB_INSET_CSS_VAR, `${rounded}px`)
    if (rounded > 0) window.dispatchEvent(new Event('resize'))
}

function clearOverlayTimers(): void {
    if (predictTimer) clearTimeout(predictTimer)
    predictTimer = null
    if (focusOutTimer) clearTimeout(focusOutTimer)
    focusOutTimer = null
    if (scrollIntoViewTimer) clearTimeout(scrollIntoViewTimer)
    scrollIntoViewTimer = null
}

/** 装事件监听（首个订阅者时一次）；返回拆除器。双源判定见顶部说明 */
function startWatchers(): () => void {
    // overlay 模式判定读真实 flag（与 index.html 早期脚本、布局变量消费同一权威值）：
    // 只判 API 存在会在「带 API 但未开 overlay」的浏览器上走 geometrychange 源、
    // 而浏览器仍在收缩视口——双源各错一半且无报错
    const vk = (navigator as { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard
    if (vk?.overlaysContent === true) {
        const onGeometry = () => {
            const height = Math.max(0, Math.round(vk.boundingRect.height))
            // 记忆高度只记非零值：收起事件（0）不得抹掉下次 focusin 预测的目标
            if (height > 0) lastKnownKeyboardHeight = height
            predictConfirmed = true
            if (predictTimer) {
                clearTimeout(predictTimer)
                predictTimer = null
            }
            // 真值与预测一致时计算值不变、transition 不受扰动；不一致则从当前插值位重定向
            commitInset(height)
        }
        const onFocusIn = (e: FocusEvent) => {
            const focused = e.target as Element
            if (!isEditableElement(focused)) return
            if (focusOutTimer) {
                clearTimeout(focusOutTimer)
                focusOutTimer = null
            }
            // 预测弹出：有记忆高度且当前收起才预腾（已展开时不折腾；首次无记忆高度
            // 等终值事件，只损失首次的同步性）
            if (lastKnownKeyboardHeight > 0 && storeState.keyboardInset === 0) {
                predictConfirmed = false
                commitInset(lastKnownKeyboardHeight)
                if (predictTimer) clearTimeout(predictTimer)
                predictTimer = setTimeout(() => {
                    predictTimer = null
                    // 确认窗口内 geometrychange 未至 = 假弹（外接键盘等），收回
                    if (!predictConfirmed) commitInset(0)
                }, PREDICT_CONFIRM_MS)
            }
            // 可见性保护：overlay 模式下视口不 resize，浏览器认为「无遮挡发生」而放弃
            // 内建的聚焦元素滚入可视区——屏幕下半部的输入框（设置页表单等滚动内容）
            // 会被键盘盖住。布局腾出动画完成后拉回最近可视位；sender 这类本就可见的
            // 聚焦目标 nearest 是 no-op。仍聚焦才拉（期间用户点走了就不抢滚动权）。
            // 视觉不可见的目标（蜜罐/折叠卡片/xterm 捕获层）跳过——滚它们只会乱页
            if (scrollIntoViewTimer) clearTimeout(scrollIntoViewTimer)
            scrollIntoViewTimer = setTimeout(() => {
                scrollIntoViewTimer = null
                if (!isVisuallyFocusable(focused)) return
                if (storeState.keyboardInset > 0 && document.activeElement === focused) {
                    focused.scrollIntoView({ block: 'nearest' })
                }
            }, OVERLAY_ANIM_MS + SCROLL_SETTLE_MS)
        }
        const onFocusOut = () => {
            if (focusOutTimer) clearTimeout(focusOutTimer)
            if (scrollIntoViewTimer) {
                clearTimeout(scrollIntoViewTimer)
                scrollIntoViewTimer = null
            }
            // 宽限期吸收输入框切换（A→B 连发 focusout/focusin）；期满无新焦点才收起
            focusOutTimer = setTimeout(() => {
                focusOutTimer = null
                if (predictTimer) {
                    clearTimeout(predictTimer)
                    predictTimer = null
                }
                commitInset(0)
            }, FOCUS_SWITCH_GRACE_MS)
        }
        vk.addEventListener('geometrychange', onGeometry)
        document.addEventListener('focusin', onFocusIn)
        document.addEventListener('focusout', onFocusOut)
        return () => {
            clearOverlayTimers()
            vk.removeEventListener('geometrychange', onGeometry)
            document.removeEventListener('focusin', onFocusIn)
            document.removeEventListener('focusout', onFocusOut)
            // 末位订阅者离场：变量一并归零清除，避免残留值糊在布局上
            storeState = { keyboardInset: 0, layoutInset: 0 }
            document.documentElement.style.removeProperty(KB_INSET_CSS_VAR)
        }
    }

    const vv = window.visualViewport
    if (!vv) return () => {}
    const baselineRef = { current: 0 }
    const update = () => {
        baselineRef.current = isEditableFocus()
            ? Math.max(baselineRef.current, window.innerHeight)
            : window.innerHeight
        const visible = Math.min(window.innerHeight, vv.offsetTop + vv.height)
        const inset = Math.max(0, Math.round(baselineRef.current - visible))
        const keyboardInset = inset >= KEYBOARD_INSET_THRESHOLD ? inset : 0
        const layoutInset = keyboardInset > 0 ? Math.max(0, Math.round(window.innerHeight - visible)) : 0
        storeUpdate({ keyboardInset, layoutInset })
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
        vv.removeEventListener('resize', update)
        vv.removeEventListener('scroll', update)
    }
}

/**
 * 按 selector 订阅键盘几何的切片。**selector 必须返回原始值**（useSyncExternalStore
 * 按 Object.is 判重渲染，返回新建对象会无限循环）。
 *
 * 典型用法：页级组件订 `s.keyboardInset > 0`（布尔，键盘周期只翻转 2 次）；
 * 键盘跟随浮层（引用评论输入）订数值本身（终值一跳 + 自身 CSS transition 跟随）。
 */
export function useKeyboardViewportSelector<T>(selector: (state: KeyboardViewport) => T): T {
    return useSyncExternalStore(storeSubscribe, () => selector(storeState))
}

/**
 * 持有键盘几何监听（不消费数值）：布局经 CSS 变量消费 store，这个消费面是**常驻**的，
 * 但它自己不触发订阅——若只靠页面组件订阅，非 chat 路由（设置页等）下订阅计数为 0、
 * watcher 不挂，动画/腾出/可见性保护整体瘫痪（2026-11-01 真机实锤）。全站布局
 * （MainLayout）挂载时调用持有，卸载时释放。
 */
export function ensureKeyboardViewportWatchers(): () => void {
    // 动画时长/曲线单源下发：消费端只引 var(--kb-anim)
    document.documentElement.style.setProperty(KB_ANIM_CSS_VAR, KB_ANIM_TRANSITION)
    return storeSubscribe(() => {})
}

/** 测试专用：归零模块 store 并清掉预测计时态（store 跨测试存活，用例间隔离用） */
export function resetKeyboardViewportForTests(): void {
    clearOverlayTimers()
    storeState = { keyboardInset: 0, layoutInset: 0 }
    lastKnownKeyboardHeight = 0
    predictConfirmed = false
}
