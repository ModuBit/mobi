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
 * 画板画布：excalidraw 的受控封装（画板特性的编辑器层）。
 * 载体（全屏/停靠容器、防误关）见 SketchDrawer；本组件只管「画」与「产出」。
 *
 * excalidraw 0.18 集成三坑（PoC 实证，勿动）：
 * 1. CSS 必须显式引入——0.18 起 CSS 不随 JS 注入，漏掉则工具条图标无样式巨型裸奔、无报错
 * 2. 容器必须有确定高度——组件根没有自带头部尺寸，auto 高度与内部 ResizeObserver
 *    形成发散反馈环（canvas 涨到浏览器上限，页面渲染错乱）
 * 3. 类型从包的 `/types` 子路径导入（主入口不 re-export ExcalidrawImperativeAPI）
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import styled from '@emotion/styled'
import { Modal } from 'antd'
import { useTranslation } from 'react-i18next'
// 0.18 起 CSS 不再随 JS 注入，必须显式引入（漏掉则工具条图标无样式巨型裸奔）
// 本组件（连带 excalidraw 重依赖）由入口处 React.lazy 拆进画板异步 chunk，不进主 bundle
import '@excalidraw/excalidraw/index.css'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { exportSketch, loadSketch } from '@/domain/sketch/sketchFile'
import { useIsDark } from '@/core/data/hooks/useIsDark'

export interface SketchCanvasProps {
    /** 重编辑载入的草图 PNG（内嵌 scene）；缺省 = 空白画布 */
    initialSketch?: Blob | null
    /** 速度模拟压感（默认开，全设备手感一致）；关闭后触控笔走真实压力通道 */
    simulatePressure?: boolean
    onCancel: () => void
    /** React 19：载体（Drawer）在重挂前抢救当前画布内容等命令式调用用 */
    ref?: Ref<SketchCanvasHandle>
}

/** 载体可命令式调用的画布手柄（React 19 ref-as-prop）：
 *  header 的取消/完成出口与画布内语义共用同一实现（取消的非空二次确认在这里） */
export interface SketchCanvasHandle {
    /** 导出当前画布为内嵌 scene 的 PNG；编辑器未就绪时返回 null，导出失败时 reject */
    exportCurrent: () => Promise<Blob | null>
    /** 取消：画布非空（有未发送内容）时二次确认，防空手误触丢作品 */
    requestCancel: () => void
    /** 完成导出：编辑器未就绪时返回 null，导出失败时 reject */
    complete: () => Promise<Blob | null>
}

/** 防抖兜底间隔：笔画进行中 onChange 逐点连发，落笔停顿后再做形状等价改写 */
const PRESSURE_FIX_DEBOUNCE_MS = 400

/** 画布几何重算延迟：需盖过 Drawer 弹入动画时长（antd motion ~300ms） */
const CANVAS_SETTLE_REFRESH_MS = 450

const Root = styled.div`
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--ant-color-bg-container, #ffffff);

    .excalidraw {
        width: 100%;
        height: 100%;
    }

    /* UI 裁剪：画板的导出/打开由 mobi 上传管线接管，无素材库/帮助/社区外链语义 */
    .default-sidebar-trigger,
    .help-icon,
    .dropdown-menu a[href*='github.com'],
    .dropdown-menu a[href*='x.com/excalidraw'],
    .dropdown-menu a[href*='discord.gg'] {
        display: none !important;
    }
`

export function SketchCanvas({ initialSketch = null, simulatePressure = true, onCancel, ref }: SketchCanvasProps) {
    const { t } = useTranslation()
    const isDark = useIsDark()
    const [editor, setEditorState] = useState<ExcalidrawImperativeAPI | null>(null)
    const fixTimerRef = useRef<number | null>(null)
    const cancelledRef = useRef(false)

    const setEditor = useCallback((api: ExcalidrawImperativeAPI) => {
        setEditorState(api)
    }, [])

    /** 取消：画布非空（有未发送内容）时二次确认，防空手误触丢作品 */
    const handleCancel = useCallback(() => {
        const hasContent = !!editor && editor.getSceneElements().length > 0
        if (!hasContent) {
            onCancel()
            return
        }
        Modal.confirm({
            title: t('sketch.discardConfirm'),
            okText: t('common.confirm'),
            cancelText: t('common.cancel'),
            onOk: onCancel,
        })
    }, [editor, onCancel, t])

    // 载体重挂（PC 停靠 ↔ 全屏切换）前经此抢救当前画布；header 的取消/完成
    // 出口与画布内语义共用同一实现（React 19 ref-as-prop 手柄）
    useImperativeHandle(ref, () => ({
        exportCurrent: () => (editor ? exportSketch(editor) : Promise.resolve(null)),
        requestCancel: handleCancel,
        complete: () => (editor ? exportSketch(editor) : Promise.resolve(null)),
    }), [editor, handleCancel])

    // 卸载后不再回写（载入是异步的，Drawer 关闭后完成会 setState 在卸载组件上）
    useEffect(() => () => { cancelledRef.current = true }, [])

    // 进入动画落定后广播 resize：excalidraw 挂载时缓存的画布 getBoundingClientRect
    // 是 Drawer 过渡动画的 transform 中间态，动画结束不触发 resize/ResizeObserver，
    // 缓存不失效——坐标换算整体偏移，画哪儿图形落到哪（实测偏移约一个 header 高度，
    // 甚至落到视口外）。editor.refresh() 只重渲染不重建 rect 缓存（实测无效），
    // 广播 window resize 才会走 excalidraw 自己的重测管线
    useEffect(() => {
        if (!editor) return
        const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), CANVAS_SETTLE_REFRESH_MS)
        return () => window.clearTimeout(t)
    }, [editor])

    /**
     * 压感事件层修正（治本，PoC 真机验证）：excalidraw 以「pointer 事件 pressure === 0.5」
     * 判定压感来源，Android 手指/触控笔上报非 0.5 的接触面积压力会被误入恒定压力分支
     * （均匀笔画）。在 window 捕获阶段把指针事件 pressure 改写为 0.5 后向原目标重派发——
     * 全设备统一速度模拟、绘制全程实时锥形，落笔无突变。
     * 合成事件（isTrusted=false）直接放行，避免重派发自拦截死循环。
     */
    useEffect(() => {
        if (!simulatePressure) return
        const rewrite = (e: PointerEvent) => {
            if (!e.isTrusted || e.pressure === 0.5) return
            e.stopPropagation()
            ;(e.target as EventTarget).dispatchEvent(new PointerEvent(e.type, {
                pointerId: e.pointerId,
                pointerType: e.pointerType,
                isPrimary: e.isPrimary,
                clientX: e.clientX,
                clientY: e.clientY,
                screenX: e.screenX,
                screenY: e.screenY,
                pressure: 0.5,
                tiltX: e.tiltX,
                tiltY: e.tiltY,
                twist: e.twist,
                width: e.width,
                height: e.height,
                buttons: e.buttons,
                button: e.button,
                bubbles: true,
                cancelable: true,
                composed: true,
            }))
        }
        // 捕获阶段挂 window：先于 excalidraw（canvas/容器/React 委托）收到任何指针事件
        window.addEventListener('pointerdown', rewrite, true)
        window.addEventListener('pointermove', rewrite, true)
        window.addEventListener('pointerup', rewrite, true)
        window.addEventListener('pointercancel', rewrite, true)
        return () => {
            window.removeEventListener('pointerdown', rewrite, true)
            window.removeEventListener('pointermove', rewrite, true)
            window.removeEventListener('pointerup', rewrite, true)
            window.removeEventListener('pointercancel', rewrite, true)
        }
    }, [simulatePressure])

    // 事件层修正关闭（真实压力模式）时，把历史笔画翻回真实压力语义的兜底不存在——
    // 模式切换只影响新笔画；已按速度模拟渲染的旧笔画保持不变（数据等价，无需回滚）。

    /**
     * 兜底修复（防抖）：仍走真实压力分支的笔画（如修正挂载前画的），落笔停顿后
     * 把「压力非 0.5 分支」翻回速度模拟。captureUpdate: NEVER——形状数据等价改写不进 undo 栈。
     */
    const handleChange = useCallback((_elements: readonly ExcalidrawElement[]) => {
        if (!editor || !simulatePressure) return
        const hasCandidate = editor.getSceneElements().some((el) => el.type === 'freedraw' && !el.simulatePressure)
        if (!hasCandidate) return

        if (fixTimerRef.current !== null) {
            window.clearTimeout(fixTimerRef.current)
        }
        fixTimerRef.current = window.setTimeout(() => {
            fixTimerRef.current = null
            if (cancelledRef.current) return
            let changed = false
            const next = editor.getSceneElements().map((el) => {
                if (el.type !== 'freedraw' || el.simulatePressure) return el
                changed = true
                return { ...el, simulatePressure: true, pressures: [] }
            })
            if (changed) {
                editor.updateScene({ elements: next, captureUpdate: 'NEVER' })
            }
        }, PRESSURE_FIX_DEBOUNCE_MS)
    }, [editor, simulatePressure])

    // 重编辑载入：initialSketch（内嵌 scene 的 PNG）→ 画板场景
    useEffect(() => {
        if (!editor || !initialSketch) return
        let cancelled = false
        void (async () => {
            try {
                const scene = await loadSketch(initialSketch)
                if (cancelled) return
                // restore 产物与 updateScene 参数形状兼容，仅 TS 宽 Record 不匹配——unknown 中转
                editor.updateScene(scene as unknown as Parameters<typeof editor.updateScene>[0])
                const files = Object.values(scene.files) as Parameters<typeof editor.addFiles>[0]
                if (files.length > 0) editor.addFiles(files)
            } catch (e) {
                // 载入失败按空画布继续（源文件损坏/外部改写）：不打断用户
                console.warn('[SketchCanvas] 草图载入失败，按空画布继续', e)
            }
        })()
        return () => { cancelled = true }
    }, [editor, initialSketch])

    return (
        <Root>
            <Excalidraw
                excalidrawAPI={setEditor}
                onChange={handleChange}
                // 跟随应用明暗主题（excalidraw 原生适配：dark 为显示层反显观感，
                // 存储色与导出两主题一致）；画布底色用包默认值，不做定制
                theme={isDark ? 'dark' : 'light'}
                UIOptions={{
                    canvasActions: {
                        // 导出/另存为/打开/存入当前文件由 mobi 上传管线接管，画板只保留「完成」一个出口
                        export: false,
                        saveAsImage: false,
                        loadScene: false,
                        saveToActiveFile: false,
                        toggleTheme: false,
                        clearCanvas: true,
                        changeViewBackgroundColor: true,
                    },
                }}
            />
        </Root>
    )
}
