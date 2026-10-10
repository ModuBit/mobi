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
 * fenced ```openui 块的渲染器（懒加载 chunk，经 OpenUIBlock 的 React.lazy 进入；
 * 组件库 + 样式约 300K+，不能进会话页首载）。
 *
 * catalog 不自建：直接用 @openuidev/react-ui 官方 openuiLibrary（82 组件），
 * Renderer 吃 fence 内源码字符串，行式 DSL 天然增量流式。
 *
 * 流式/封口校验策略（票 01 定稿）：
 * - 流式期间宽松——Renderer 内置 streaming parser 对悬空引用渲染占位，不报错；
 * - 封口后（streaming=false）onError 给出的结构化错误（未知组件/缺必填 props 等）
 *   以「降级显示」呈现：非法语句由 parser 丢弃，块本身不移除，错误摘要内联提示。
 *   turn journal 落点：web 侧暂无 journal 写通道，降级为 UI 呈现，缺口记 pending。
 *
 * 回路②（票 03）：onAction 的 continue_conversation → 经 actionContext 注入的
 * sendMessage 走手打消息同一链路。发送只可能由用户手势（Button 点击/表单提交）
 * 触发——react-lang 的 onAction 仅在这些交互回调里被调起；流式期间 UI 尚未封口，
 * 一律不发送。
 */

import { useCallback, useState } from 'react'
import { Alert } from 'antd'
import { Renderer, type ActionEvent, type OpenUIError } from '@openuidev/react-lang'
import { ThemeProvider, openuiLibrary } from '@openuidev/react-ui'
import '@openuidev/react-ui/index.css'
import '@openuidev/react-ui/defaults.css'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { OPENUI_LIGHT_THEME, OPENUI_DARK_THEME } from './theme'
import { buildOpenUIMessage } from './actionMessage'
import { useOpenUISendMessage } from './actionContext'

export interface OpenUIRendererProps {
    /** fence 内的 OpenUI Lang 源码 */
    code: string
    /** 所在消息是否仍在流式（流式期间表单交互禁用、错误不呈现） */
    streaming: boolean
}

/** 最多内联展示的错误条数（避免长错误列表撑爆消息流） */
const MAX_SHOWN_ERRORS = 3

export default function OpenUIRenderer({ code, streaming }: OpenUIRendererProps) {
    const mode = useUiStore((s) => resolveTheme(s.theme))
    const [errors, setErrors] = useState<OpenUIError[]>([])
    const sendMessage = useOpenUISendMessage()

    // 回路②：用户手势触发的 continue_conversation 才组装发送（见文件头注释）；
    // 无 provider（会话页外的 markdown 渲染）静默 no-op
    const handleAction = useCallback((event: ActionEvent) => {
        if (streaming) return
        if (event.type !== 'continue_conversation') return
        const text = buildOpenUIMessage(event)
        if (text && sendMessage) sendMessage(text)
    }, [streaming, sendMessage])

    return (
        <div className="openui-block">
            <ThemeProvider mode={mode} lightTheme={OPENUI_LIGHT_THEME} darkTheme={OPENUI_DARK_THEME}>
                <Renderer
                    response={code}
                    // react-ui 与 react-lang 双 d.ts 实例的类型身份不同（同 API），运行时同库
                    library={openuiLibrary as never}
                    isStreaming={streaming}
                    onError={setErrors}
                    onAction={handleAction}
                />
            </ThemeProvider>
            {streaming || errors.length === 0 ? null : (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 8 }}
                    message={`交互 UI 有 ${errors.length} 处无效语句已被忽略`}
                    description={
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {errors.slice(0, MAX_SHOWN_ERRORS).map((e, i) => (
                                <li key={i}>
                                    {e.statementId ? `${e.statementId}：` : ''}{e.message}
                                </li>
                            ))}
                            {errors.length > MAX_SHOWN_ERRORS ? <li>…等共 {errors.length} 条</li> : null}
                        </ul>
                    }
                />
            )}
        </div>
    )
}
