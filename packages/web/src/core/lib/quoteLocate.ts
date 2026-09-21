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
 * 引用条目点击 → 消息级定位（票 06）：
 * 在整个文档查消息容器锚（data-quote-message-id，选区引用锚点契约的读侧反向消费），
 * 命中则平滑滚动居中 + 短暂高亮闪烁；未命中（源消息不在当前滑动窗口）静默返回——
 * 窗口化渲染下源消息可能未挂载，此时无反应是约定行为（spec 用户故事 23），不报错不跳变。
 *
 * 纯 DOM 命令式动作、无 React 状态（放 core/lib：与 composerDrafts 等同层，domain/chat
 * 保持纯函数），由 UserBlocksView 的 env.onQuoteLocate 能力位接线（对齐 onEditSketch 的
 * 可选模式：能力只在聊天列表接线处有意义，非聊天上下文退化为纯展示）。
 *
 * 高亮闪烁样式（{@link QUOTE_FLASH_CLASS} 的 keyframes 定义）由 React 树侧注入：
 * ChatContainer 挂 emotion Global 单份注入（quoteFlashStyles，随聊天列表生灭；
 * 本模块无渲染上下文，且 @emotion/react 不含 injectGlobal）。
 */

/** 高亮类名（ChatContainer 的 Global 样式按此名定义闪烁动画；导出供测试断言） */
export const QUOTE_FLASH_CLASS = 'quote-locate-flash'

/** 闪烁时长（ms）：到期由定时器摘类（不用 animationend——jsdom 不跑动画，永不触发） */
export const QUOTE_FLASH_MS = 1200

/** 在飞的摘类定时器与目标：连续点击时先摘旧类/清旧定时器，防「新闪烁被上一次的到期提前掐灭」与定时器堆积 */
let activeFlash: { el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null

/**
 * 定位执行：查锚 → 解析高亮目标 → scrollIntoView + 挂高亮类，定时器到期摘除。
 */
export function locateQuotedMessage(messageId: string): void {
    // 消息 id 实际是 uuid，仍防御性转义后再进选择器
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(messageId)
        : messageId
    const anchor = document.querySelector(`[data-quote-message-id="${escaped}"]`)
    if (!anchor) return

    // 锚点载体一律 display:contents（无盒——scrollIntoView 无从定位、背景/描边无处附着，
    // 即「display:contents 零矩形」已知坑），定位与高亮落到锚内首个真实盒后代
    const target = anchor instanceof HTMLElement && anchor.style.display === 'contents'
        ? anchor.firstElementChild ?? anchor
        : anchor

    // 上一次闪烁还挂着：先摘掉再重放，且清掉旧定时器（否则旧定时器会把新闪烁提前掐灭）
    if (activeFlash) {
        clearTimeout(activeFlash.timer)
        activeFlash.el.classList.remove(QUOTE_FLASH_CLASS)
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // 先摘类再强制重排后重挂：连续点击同一目标时闪烁动画从头重放
    target.classList.remove(QUOTE_FLASH_CLASS)
    void (target as HTMLElement).offsetWidth
    target.classList.add(QUOTE_FLASH_CLASS)
    activeFlash = {
        el: target as HTMLElement,
        timer: setTimeout(() => {
            target.classList.remove(QUOTE_FLASH_CLASS)
            activeFlash = null
        }, QUOTE_FLASH_MS),
    }
}
