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
 *
 * 回路③原地更新（票 04，per-action 粒度票 02）：agent 正文的 openui 块带锚点
 * （actionContext 注入的 text block id），每个操作的状态由值域约定变量（catalog
 * prompt 教学，名字自由）承载，存储键为 `anchor#var` 复合键——同块多操作互不串。
 * 操作身份由 mobiLibrary 覆盖 Button 的点击 registry 提供（statementId → 绑定表
 * 回查），phase 变化经 initialState 的 reactive binding 重建（initialize 只覆盖
 * $ 键，表单值保留），按钮文案随派生三元翻转，markdown content 不变。running
 * 期间同操作重复点击去重，不同操作互不阻塞。
 */

import { useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Alert } from 'antd'
import { Renderer, type ActionEvent, type OpenUIError } from '@openuidev/react-lang'
import { useTranslation } from 'react-i18next'
import { ThemeProvider } from '@openuidev/react-ui'
import '@openuidev/react-ui/index.css'
import '@openuidev/react-ui/defaults.css'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { OPENUI_LIGHT_THEME, OPENUI_DARK_THEME } from './theme'
import { buildOpenUIMessage } from './actionMessage'
import { useUiSendMessage, useOpenUIAnchor } from './actionContext'
import { useOpenUIActionStore } from './actionStore'
import { actionStateKey, type OpenUIActionPhase } from './actionState'
import { resolveMergedSnapshotInjection } from './snapshotInjection'
import { resolveActionBindings, EMPTY_BINDINGS } from './bindingParser'
import { mobiLibrary, takeClickedActionStatementId } from './mobiLibrary'

export interface OpenUIRendererProps {
    /** fence 内的 OpenUI Lang 源码 */
    code: string
    /** 所在消息是否仍在流式（流式期间表单交互禁用、错误不呈现） */
    streaming: boolean
    /** fence 身份序号（状态持久化票 01）：null = 非 TextBlock 注解路径，锚点退回 block 级 */
    fenceIndex?: number | null
}

/** 最多内联展示的错误条数（避免长错误列表撑爆消息流） */
const MAX_SHOWN_ERRORS = 3

export default function OpenUIRenderer({ code, streaming, fenceIndex }: OpenUIRendererProps) {
    // 锚点下钻（状态持久化票 01）：TextBlock 注解路径拼 fence 段——一个 text block
    // 多个 openui 块各自独立状态；derive 配对消息 meta 时写的就是这个 full 键，单键读
    const baseAnchor = useOpenUIAnchor()
    const anchor = baseAnchor !== null && fenceIndex != null ? `${baseAnchor}:${fenceIndex}` : baseAnchor
    const mode = useUiStore((s) => resolveTheme(s.theme))
    const [errors, setErrors] = useState<OpenUIError[]>([])
    const sendMessage = useUiSendMessage()
    // 回灌消息表头的本地化（code-review 2026-10-11：组装纯函数不硬编码 UI 语言）
    const { t } = useTranslation()
    const messageLabels = useMemo(() => ({
        namedFormValues: (formName: string) => t('chat.openuiMessage.formValues', { formName }),
        uiValues: t('chat.openuiMessage.uiValues'),
    }), [t])
    // 操作绑定表（per-action 票 02）：本 fence 的操作 → 状态变量绑定。流式期间跳过
    // AST 全量解析（code 每 delta 变化，解析结果无处消费——点击被 streaming 闸门挡、
    // 快照回注只在封口后生效），封口时 streaming 翻转触发一次真解析
    const bindings = useMemo(
        () => (streaming ? EMPTY_BINDINGS : resolveActionBindings(code)),
        [code, streaming],
    )
    // per-action phase/快照：**per-key 切片订阅**（useShallow 数组等价）而非整 Map——
    // 整 Map 订阅下任意块的写入都换新 Map 引用，屏幕上全部 openui 块重渲染且
    // react-lang 随 initialState 引用变化重建 store；切片后只有本 fence 有变化的块重渲染。
    // 事件内读最新 Map 走 getState（handleAction 去重闸），不依赖订阅
    const setPhase = useOpenUIActionStore((s) => s.setPhase)

    // 本 fence 的操作状态变量集：绑定表为准（bindingParser 与 react-lang 同
    // parser——源码 react-lang 解析不了时这里也为空，纯正则降级通道已随
    // 63aacaa5 裁决删除，不存在「绑定表空但 UI 正常渲染」的中间态）
    const stateVars = bindings.stateVars

    // 各操作的当前 phase（anchor === null 时无状态可查，恒 idle）
    const phaseValues = useOpenUIActionStore(
        useShallow((s) =>
            anchor === null
                ? []
                : stateVars.map((v) => s.phases.get(actionStateKey(anchor, v)) ?? s.phases.get(anchor) ?? 'idle' as const),
        ),
    )
    const phasesByVar = useMemo(() => {
        const byVar = new Map<string, OpenUIActionPhase>()
        stateVars.forEach((v, i) => byVar.set(v, phaseValues[i]!))
        return byVar
    }, [stateVars, phaseValues])

    // 表单快照（状态持久化票 02，票 03 多表单）：per-action 粒度下各操作快照随各自
    // 复合键派生。切片订阅本 fence 的快照值；逐条解析后合并注入映射
    // （resolveMergedSnapshotInjection）——不能先合并原始快照再解析：两个表单容器会
    // 破坏「唯一对象值键」判据整体降级（E2E 实锤）
    const snapshotValues = useOpenUIActionStore(
        useShallow((s) =>
            anchor === null
                ? []
                : [...stateVars, null].map((v) =>
                    s.formStates.get(actionStateKey(anchor, v)) ?? (v === null ? s.formStates.get(anchor) : undefined),
                ),
        ),
    )
    const snapshotInjection = useMemo(
        () => resolveMergedSnapshotInjection(snapshotValues, bindings.forms),
        [snapshotValues, bindings.forms],
    )

    // 回路②：用户手势触发的 continue_conversation 才组装发送（见文件头注释）；
    // 无 provider（会话页外的 markdown 渲染）静默 no-op。
    // 回路③（per-action 票 02）：操作身份来自点击 registry——mobiLibrary 覆盖 Button
    // 在同步帧写入被点按钮的 statementId（react-lang 的 ActionEvent 不带身份：载荷在
    // steps 循环前捕获，Set 置位不进 formState，实测实证），回查绑定表 actions 映射
    // 得状态变量；statementId 无绑定（模型偏离教学/inline 按钮）→ 三级推断兜底，全落空
    // → null，状态键退化为裸 anchor（块级行为）。running 去重按操作粒度，互不阻塞。
    const handleAction = useCallback((event: ActionEvent) => {
        if (streaming) return
        // 取走在点击 capture 同步帧写入的身份（取后即清）——必须先于任何 early
        // return，否则 open_url 等非本回路事件的 statementId 残留 registry，被后续
        // 无 capture 前置的事件读到陈旧身份错键（code-review 2026-10-11）
        const clickedId = takeClickedActionStatementId()
        if (event.type !== 'continue_conversation') return
        const boundVar = clickedId !== null ? bindings.actions.get(clickedId) : undefined
        const payload = event.formState != null && typeof event.formState === 'object' ? event.formState as Record<string, unknown> : null
        // 身份推断：registry statementId 绑定（最可信）→ 绑定表唯一状态变量（单操作块
        // 恒定走它——保证首次与后续点击同键，去重才成立）
        const stateVar = boundVar
            ?? (bindings.stateVars.length === 1 ? bindings.stateVars[0]! : null)
        // running 去重（票 02 起 per-action）：只挡同一状态键（同操作变量；降级块级
        // 键同理）的重复点击——事件帧读 store 最新值（getState，不经订阅），与乐观
        // 翻转写同一把钥匙
        const stateKey = actionStateKey(anchor ?? '', stateVar)
        const current = anchor !== null ? useOpenUIActionStore.getState().phases.get(stateKey) ?? 'idle' : 'idle'
        if (current === 'running') return
        const text = buildOpenUIMessage(event, messageLabels)
        if (!text) return
        // 发送失败回滚：乐观 running 只有落库后扫描派生才能翻终态，请求失败时消息
        // 不会落库、去重闸门还挡着重试——不回滚会永久卡 running
        if (anchor !== null) setPhase(stateKey, 'running')
        Promise.resolve(sendMessage?.(text, {
            origin: 'openui',
            ...(anchor !== null ? { anchor } : {}),
            // 操作身份（per-action 票 02）：daemon 落 meta.openuiStateVar 供 derive 配对
            ...(stateVar !== null ? { stateVar } : {}),
            // 表单快照（状态持久化票 02）：原始 formState 整体携带（含 $ 绑定变量——
            // 快照目的就是恢复勾选态），daemon 落 meta.openuiFormState 供刷新后回注
            ...(payload !== null ? { formState: payload } : {}),
        }))
            .catch(() => {
                if (anchor !== null) setPhase(stateKey, 'idle')
            })
    }, [streaming, anchor, bindings, setPhase, sendMessage, messageLabels])

    const initialState = useMemo(() => {
        if (anchor === null) return undefined
        let hasPhase = false
        const phaseKeys: Record<string, OpenUIActionPhase> = {}
        for (const [v, phase] of phasesByVar) {
            if (phase === 'idle') continue
            hasPhase = true
            phaseKeys[v] = phase
        }
        if (!hasPhase && !snapshotInjection) return undefined
        return { ...phaseKeys, ...snapshotInjection }
    }, [anchor, phasesByVar, snapshotInjection])

    return (
        <div className="openui-block">
            <ThemeProvider mode={mode} lightTheme={OPENUI_LIGHT_THEME} darkTheme={OPENUI_DARK_THEME}>
                <Renderer
                    response={code}
                    // react-ui 与 react-lang 双 d.ts 实例的类型身份不同（同 API），运行时同库
                    library={mobiLibrary as never}
                    isStreaming={streaming}
                    onError={setErrors}
                    onAction={handleAction}
                    initialState={initialState}
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
