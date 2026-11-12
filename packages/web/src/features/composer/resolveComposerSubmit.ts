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

import { bucketCompletedAttachments, type FileAttachment } from '@/core/lib/fileAttachments'
import { isSegmentEmpty, type ComposerQuoteRef, type ComposerSegments } from '@/domain/chat/composerSegments'

/**
 * composer 提交解析（ChatComposer / NewSessionPage 共用单源）。
 *
 * 「能不能发、发什么」的守卫与分段组装此前在两页各写一遍（面板开/上传中/空分段，
 * 且上传守卫已出现过一边修、另一边靠注释提醒同步的复制债）。本 module 只做判定与
 * 组装；提示文案、发送管线、清空/焦点/导航等副作用仍归页面——两个页面的发送
 * adapter 不同（会话现有消息 vs spawn 后首条消息），不在本 module 的接口内。
 */

/** 阻止提交的原因：disabled=调用方门控未过；panel-open=Enter 是面板选择；uploading=附件未完成；empty=无内容 */
export type ComposerSubmitBlocked = 'disabled' | 'panel-open' | 'uploading' | 'empty'

export type ComposerSubmitResolution =
    | { ok: false; blocked: ComposerSubmitBlocked }
    | { ok: true; segments: ComposerSegments }

export interface ComposerSubmitInput {
    /** 正文（会话页 = getWireText 的 Markdown 序列化；新会话页同源，未就绪回退文本镜像） */
    text: string
    /** 引用（会话页从编辑器 chip 节点收集；新会话页无引用通道，缺省 []） */
    quotes?: ComposerQuoteRef[]
    attachments: FileAttachment[]
    /** mention/slash 面板开着时 Enter 是选择不是提交（缺省 false：无面板语义的调用方不传） */
    panelOpen?: boolean
    /** 调用方门控（会话页 canSend；缺省 true：新会话页的「能否建会话」由页面自判） */
    enabled?: boolean
}

/**
 * 按固定优先级判定：disabled → panel-open → uploading → empty → 完整分段。
 * 上传守卫必须先于空分段判定——否则「只有上传中附件」会被判成 empty 静默吞掉。
 *
 * empty 的语义随调用方：会话页视为不可发送；新会话页只是「不带首条消息建会话」
 * （按钮语义是创建会话），由调用方忽略该分支而不是在此特化。
 */
export function resolveComposerSubmit(input: ComposerSubmitInput): ComposerSubmitResolution {
    if (input.enabled === false) return { ok: false, blocked: 'disabled' }
    if (input.panelOpen === true) return { ok: false, blocked: 'panel-open' }
    if (input.attachments.some(a => a.status === 'uploading')) return { ok: false, blocked: 'uploading' }

    const segments: ComposerSegments = {
        text: input.text,
        ...bucketCompletedAttachments(input.attachments),
        quotes: input.quotes ?? [],
    }
    if (isSegmentEmpty(segments)) return { ok: false, blocked: 'empty' }
    return { ok: true, segments }
}
