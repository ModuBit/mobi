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
import { App } from 'antd'
import { useTranslation } from 'react-i18next'
// 0.18 起 CSS 不再随 JS 注入，必须显式引入（漏掉则工具条图标无样式巨型裸奔）
// 本组件（连带 excalidraw 重依赖）由入口处 React.lazy 拆进画板异步 chunk，不进主 bundle
import '@excalidraw/excalidraw/index.css'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { exportSketch, loadSketch } from '@/domain/sketch/sketchFile'
import { prepareSceneUpdate } from '@/domain/sketch/sceneAssembly'
import { SKETCH_CANVAS_SETTLE_MS } from '@/domain/sketch/sketchLayout'
import { attachPressureRewrite, createPressureFixer } from './pressureFix'
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
    /** 取消：场景相对打开时有变化才二次确认，防空手误触丢作品 */
    requestCancel: () => void
    /**
     * 完成导出。四态：
     * - Blob：场景有内容且相对打开时有修改，导出的内嵌 scene PNG
     * - 'unchanged'：场景就绪且内容相对打开时无修改（重编辑未动笔）——调用方
     *   直接关闭即可，无需导出上传（保留原附件）
     * - null：场景就绪且无内容（空画布 / 重编辑后删光）——调用方按「无产物完成」处理
     * - undefined：画布未就绪（编辑器未初始化 / 场景尚未载入）——调用方必须忽略本次
     *   完成，绝不能与 null 混同：重编辑语义下 null = 删除附件，会把有内容的附件静默删掉
     */
    complete: () => Promise<Blob | null | 'unchanged' | undefined>
}

/** 画布几何重算延迟：单源 sketchLayout 从载体动画时长派生（settle 必须盖过全部动画，
 *  否则动画 transform 中间态被缓存为画布 rect → 绘制坐标整体偏移） */
const CANVAS_SETTLE_REFRESH_MS = SKETCH_CANVAS_SETTLE_MS

/**
 * 场景指纹：取消确认的「有无修改」检测基准。剔除每次提交都会变的簿记字段
 * （version/versionNonce/updated）与压感簿记字段（simulatePressure/pressures——
 * 压感兜底会对历史笔画做数据等价改写，属同一内容，计入会让未动笔的取消误弹确认），
 * 只留内容语义（元素几何/样式/背景色）——undo 撤回初始状态后指纹相等，正确地视为
 * 「无修改」；viewBackgroundColor 纳入（背景色可改且属用户内容）。导出仅供测试。
 */
export function sceneFingerprint(api: Pick<ExcalidrawImperativeAPI, 'getSceneElements' | 'getAppState'>): string {
    const elements = api.getSceneElements().map(({ version: _v, versionNonce: _n, updated: _u, ...rest }) => {
        // 压感簿记字段仅 freedraw 元素具有：运行时 delete 归一化，绕开联合类型的收窄麻烦
        delete (rest as Record<string, unknown>).simulatePressure
        delete (rest as Record<string, unknown>).pressures
        return rest
    })
    return JSON.stringify([elements, api.getAppState().viewBackgroundColor])
}

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
    // modal 实例经 AntApp 上下文获取：静态 Modal.confirm 渲染在独立 root，
    // 不消费 ConfigProvider 主题（dark 下白底蓝按钮，与暖调设计系统脱节）
    const { modal } = App.useApp()
    const [editor, setEditorState] = useState<ExcalidrawImperativeAPI | null>(null)
    const cancelledRef = useRef(false)
    // 打开时的场景指纹（变更检测基准）：null = 未捕获（捕获前不弹确认，宁多勿丢）
    const initialFingerprintRef = useRef<string | null>(null)

    /** 取消：场景相对打开时有变化才二次确认（空画布直接开、重编辑未动笔直接关），防误触丢作品 */
    const handleCancel = useCallback(() => {
        // 变化检测：与打开时的场景指纹比对。editor 未就绪/指纹未捕获（异常时序）按
        // 有变化处理——宁可多弹一次确认也不静默丢作品
        const changed = !!editor && !!initialFingerprintRef.current
            && sceneFingerprint(editor) !== initialFingerprintRef.current
        if (!changed) {
            onCancel()
            return
        }
        // 放弃修改是危险操作：确认按钮走 danger 语义（土地砖红，非 primary 灰）。
        // zIndex 抬过画板浮层（1001）——antd Modal 默认 1000 会被浮层盖住
        modal.confirm({
            zIndex: 1100,
            title: t('sketch.discardConfirm'),
            okText: t('common.confirm'),
            cancelText: t('common.cancel'),
            okButtonProps: { danger: true },
            onOk: onCancel,
        })
    }, [editor, modal, onCancel, t])

    // 载体 header 的取消/完成出口与画布内语义共用同一实现（React 19 ref-as-prop 手柄）
    useImperativeHandle(ref, () => ({
        requestCancel: handleCancel,
        // 指纹未捕获 = 场景尚未就绪（编辑器初始化中 / 重编辑内容载入中）→ undefined：
        // 调用方必须忽略，绝不能落进「null = 删光」语义（会把有内容的附件静默删除）。
        // 场景就绪后：无内容（空画布 / 重编辑后删光）→ null（重编辑 = 删除附件，新建 = 仅关闭），
        // 绝不上传一张空白图；内容与打开时指纹相同（重编辑未动笔）→ 'unchanged'（免导出上传，
        // 与取消确认共用同一指纹判据——undo 回初始状态同样视为无修改）
        complete: () => {
            if (!editor || initialFingerprintRef.current === null) return Promise.resolve(undefined)
            if (editor.getSceneElements().length === 0) return Promise.resolve(null)
            if (sceneFingerprint(editor) === initialFingerprintRef.current) return Promise.resolve('unchanged')
            return exportSketch(editor)
        },
    }), [editor, handleCancel])

    // 卸载后不再回写（载入是异步的，Drawer 关闭后完成会 setState 在卸载组件上）
    useEffect(() => () => { cancelledRef.current = true }, [])

    // 进入动画落定后广播 resize：excalidraw 挂载时缓存的画布 getBoundingClientRect
    // 若落在载体开合动画（transform）中间态，动画结束不触发 resize/ResizeObserver
    // （transform 不改变布局），缓存不失效——坐标换算整体偏移。editor.refresh() 只重
    // 渲染不重建 rect 缓存（实测无效），广播 window resize 才会走 excalidraw 自己的重测管线
    useEffect(() => {
        if (!editor) return
        const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), CANVAS_SETTLE_REFRESH_MS)
        return () => window.clearTimeout(t)
    }, [editor])

    // 压感事件层修正（见 pressureFix 模块文档）：window 捕获层改写 + 落笔停顿后的
    // 防抖兜底，组合逻辑同在 pressureFix；本组件只负责按 simulatePressure 开关装配
    useEffect(() => {
        if (!simulatePressure) return undefined
        return attachPressureRewrite()
    }, [simulatePressure])

    // 事件层修正关闭（真实压力模式）时，把历史笔画翻回真实压力语义的兜底不存在——
    // 模式切换只影响新笔画；已按速度模拟渲染的旧笔画保持不变（数据等价，无需回滚）。

    // 防抖兜底 fixer：editor 就绪时创建（dispose 丢弃未触发的兜底），onChange 转发
    const fixerRef = useRef<ReturnType<typeof createPressureFixer> | null>(null)
    useEffect(() => {
        if (!editor) return undefined
        const fixer = createPressureFixer(editor)
        fixerRef.current = fixer
        return () => {
            fixerRef.current = null
            fixer.dispose()
        }
    }, [editor])
    const handleChange = useCallback(() => {
        if (simulatePressure) fixerRef.current?.onChange()
    }, [simulatePressure])

    // 重编辑载入：initialSketch（内嵌 scene 的 PNG）→ 画板场景
    // 主题经 ref 读取：isDark 变化时 theme prop 已由 excalidraw 自行同步，
    // 载入 effect 不需要（也不应该）随之重跑重放 scene
    const isDarkRef = useRef(isDark)
    isDarkRef.current = isDark
    useEffect(() => {
        if (!editor || !initialSketch) return
        let cancelled = false
        void (async () => {
            try {
                const scene = await loadSketch(initialSketch)
                if (cancelled) return
                // 主题剥离/重灌等装配知识在 sceneAssembly.prepareSceneUpdate（见其文档）；
                // update 参数原样传 updateScene，TS 宽 Record 不匹配由一行 cast 中转
                const { update, files } = prepareSceneUpdate(scene, isDarkRef.current ? 'dark' : 'light')
                editor.updateScene(update as unknown as Parameters<typeof editor.updateScene>[0])
                if (files.length > 0) editor.addFiles(files as Parameters<typeof editor.addFiles>[0])
                // 场景提交后捕获「打开时」指纹（重编辑未动笔 = 取消时无变化，免确认）
                window.setTimeout(() => {
                    if (!cancelled) initialFingerprintRef.current = sceneFingerprint(editor)
                }, 0)
            } catch (e) {
                // 载入失败按空画布继续（源文件损坏/外部改写）：不打断用户。但必须把指纹
                // 基准补成空场景——否则基准缺失会让取消确认把「画了内容」误判为无变化，
                // 绕过确认静默丢失作品
                console.warn('[SketchCanvas] 草图载入失败，按空画布继续', e)
                if (!cancelled) initialFingerprintRef.current = sceneFingerprint(editor)
            }
        })()
        return () => { cancelled = true }
    }, [editor, initialSketch])

    // 空白画布（无重编辑内容）的场景指纹：editor 就绪后捕获
    useEffect(() => {
        if (!editor || initialSketch) return
        const t = window.setTimeout(() => { initialFingerprintRef.current = sceneFingerprint(editor) }, 0)
        return () => window.clearTimeout(t)
    }, [editor, initialSketch])

    return (
        <Root>
            <Excalidraw
                excalidrawAPI={setEditorState}
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
