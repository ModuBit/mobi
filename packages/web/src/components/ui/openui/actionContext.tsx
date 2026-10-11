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
 * UI 回灌（回路② send-message → intake）的注入 seam（generative-ui 票 03，票 06 起承载
 * app 档、2026-10-10 收口更名）。
 *
 * fenced openui 块与沙箱 app iframe 都渲染在 markdown / 产物视图深处，天然够不到
 * ChatContainer 的发送通道；这里用轻量 context 把「发一条用户消息」从会话页注入
 * 进来——provider 端复用 ChatContainer 既有的 useSendMessage mutation 实例，保证与
 * 手打消息同链路（乐观气泡 / 排队轨道 / rewind 清除 / daemon intake 单点），不新开通道。
 *
 * 本模块必须保持零重依赖（进主 bundle）；OpenUI 事件 → 文本的组装在
 * actionMessage.ts，由懒 chunk 内的 renderer 消费。
 */

import { createContext, useContext, type ReactNode } from 'react'
import type { UiMessageOrigin } from '@mobi/shared'

/** UI 回灌注入的发送入口：组装好的消息文本，与手打消息走同一 intake。
 *  origin 必填显式（'openui' fenced 块 / 'app' 沙箱 app bridge），anchor 为档③锚点；
 *  返回发送 promise（可等待失败——档③据此回滚乐观 running），不关心结果的调用方忽略即可 */
export type UiSendMessage = (text: string, opts: { origin: UiMessageOrigin; anchor?: string; formState?: Record<string, unknown> }) => void | Promise<void>

const UiSendContext = createContext<UiSendMessage | null>(null)

export function UiSendProvider({
    sendMessage,
    children,
}: {
    sendMessage: UiSendMessage
    children: ReactNode
}) {
    return <UiSendContext.Provider value={sendMessage}>{children}</UiSendContext.Provider>
}

/**
 * 取 UI 回灌发送入口。无 provider（markdown 在会话页外渲染——Drawer 预览、
 * 独立文档视图等）返回 null，调用方静默 no-op：交互块照常渲染，只是不发消息。
 */
export function useUiSendMessage(): UiSendMessage | null {
    return useContext(UiSendContext)
}

/**
 * 回路③锚点（generative-ui 票 04）：agent 正文 text block 的 chat block id
 * （quote annotations 同一词汇，落库稳定）。由 blocks/index.tsx 的 agent-text
 * 分支按消息粒度提供——档③的「原地更新」靠它把 action 状态定向回发起 UI 块，
 * markdown content 不变。非 agent 正文（用户消息/Drawer 预览）无锚点 → 档③
 * 自动降级为档②纯发送。
 */
const OpenUIAnchorContext = createContext<string | null>(null)

export function OpenUIAnchorProvider({ anchor, children }: { anchor: string; children: ReactNode }) {
    return <OpenUIAnchorContext.Provider value={anchor}>{children}</OpenUIAnchorContext.Provider>
}

/** 取档③锚点；无 provider 返回 null（档③禁用） */
export function useOpenUIAnchor(): string | null {
    return useContext(OpenUIAnchorContext)
}
