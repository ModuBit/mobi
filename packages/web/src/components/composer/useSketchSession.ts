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
 * 草图会话状态机（composer 画板的 module 层）：三入口（面板按钮 / 附件卡重编辑 /
 * 气泡重编辑）汇聚到一台小状态机，持有三条注释背书的不变量——
 * 1. everOpened 门控：React.lazy 首 render 即拉 excalidraw chunk，未开过不挂载载体
 * 2. 完成语义：png=null（场景无内容）时重编辑=删除旧附件、新建=仅关闭，绝不上传空图
 * 3. 异步回填守卫：重编辑回源返回时若会话已切换（editingId 不匹配）丢弃，不污染新会话
 *
 * ChatComposer 退为「按状态渲染 Drawer」；依赖经参数注入（附件装配 / 删除 / 失败提示），
 * 完成/回填语义可经 renderHook 直接测试——interface 即测试面。
 */

import { useCallback, useRef, useState } from 'react'
import type { SketchMark } from '@mobi/shared'
import type { FileAttachment } from '@/core/lib/fileAttachments'
import type { FileRefContext } from '@/core/utils/fileUrl'
import { loadSketchSource } from '@/domain/sketch/sketchSource'

/** 会话：null = 关闭。token = 每次 open 递增的令牌（异步回填守卫的唯一依据——
 *  editingId/initialSketch 无法区分「同形」的先后会话：新建与气泡重编辑都是
 *  {initialSketch: null, editingId: null}，慢 fetch 迟到会污染后开的画布）；
 *  initialSketch = 重编辑载入源（null = 空白画布）；
 *  editingId = 重编辑目标附件（null = 新建路径，产物作为新附件） */
export interface SketchSession {
    token: number
    initialSketch: Blob | null
    /** 重编辑的附件 id；null = 新建（产物作为新附件） */
    editingId: string | null
}

export interface UseSketchSessionDeps {
    /** 画板产物进附件（replaceId 非空 = 重编辑换旧附件），由 useAttachmentHandling 提供 */
    addSketchFile: (file: File, sketch: SketchMark, replaceId?: string) => void
    /** 删除附件（png=null 完成语义：重编辑删光 = 删除旧附件） */
    removeAttachment: (id: string) => void
    /** 取数失败提示（toast 等渠道由调用方决定） */
    notifyLoadFailed: () => void
    /** 解析上下文：气泡/附件回源 fetch 的 read-file 寻址 */
    resolveContext: FileRefContext
}

export function useSketchSession(deps: UseSketchSessionDeps) {
    const { addSketchFile, removeAttachment, notifyLoadFailed, resolveContext } = deps
    const [session, setSession] = useState<SketchSession | null>(null)
    // 首开后不复位：exit 动画需要载体保持挂载，且避免重复触发 chunk 加载
    const [everOpened, setEverOpened] = useState(false)
    // 会话令牌发生器：每次 open 递增
    const tokenRef = useRef(0)

    const open = useCallback((next: Omit<SketchSession, 'token'>) => {
        setEverOpened(true)
        const token = ++tokenRef.current
        setSession({ ...next, token })
        return token
    }, [])

    /** 面板按钮：空白画布新建 */
    const openNew = useCallback(() => {
        open({ initialSketch: null, editingId: null })
    }, [open])

    /**
     * 附件卡重编辑：本地字节可用（上传中/正常态）直接载入；恢复态占位附件 file 是
     * 空壳（size 恒 0），统一「先开画板再异步回源」——回源完成由回填守卫（editingId
     * 匹配）写入，失败 toast 留空画布可继续画。
     */
    const openForAttachment = useCallback((attachment: FileAttachment) => {
        const token = open({ initialSketch: attachment.file.size > 0 ? attachment.file : null, editingId: attachment.id })
        const path = attachment.path
        if (attachment.file.size > 0 || !path) return
        loadSketchSource({ path }, resolveContext)
            .then(blob => setSession(prev => (prev && prev.token === token ? { ...prev, initialSketch: blob } : prev)))
            .catch(() => notifyLoadFailed())
    }, [open, resolveContext, notifyLoadFailed])

    /** 气泡重编辑：历史消息附件无本地字节，先开画板再异步回源（与附件卡同一时序） */
    const openFromBubble = useCallback((path: string) => {
        const token = open({ initialSketch: null, editingId: null })
        loadSketchSource({ path }, resolveContext)
            .then(blob => setSession(prev => (prev && prev.token === token ? { ...prev, initialSketch: blob } : prev)))
            .catch(() => notifyLoadFailed())
    }, [open, resolveContext, notifyLoadFailed])

    /**
     * 完成：产物装 File 走附件装配（editingId 非空 = 重编辑换旧附件）。
     * png null = 无内容完成：重编辑语义等同删除旧附件（用户指定），新建仅关闭画板。
     */
    const complete = useCallback((png: Blob | null, filename: string, sketchMark: SketchMark) => {
        if (!png) {
            if (session?.editingId) removeAttachment(session.editingId)
            setSession(null)
            return
        }
        const file = new File([png], filename, { type: 'image/png' })
        addSketchFile(file, sketchMark, session?.editingId ?? undefined)
        setSession(null)
    }, [session?.editingId, addSketchFile, removeAttachment])

    /** 取消（含取消确认后的放弃）：直接关闭 */
    const cancel = useCallback(() => setSession(null), [])

    return { session, everOpened, openNew, openForAttachment, openFromBubble, complete, cancel }
}
