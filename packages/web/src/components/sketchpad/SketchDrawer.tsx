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
 * 画板载体（Drawer 容器）：
 * - 移动端：全屏 Drawer（最大手指操作空间）
 * - PC 停靠：从 composer 上方向上抽出的底部抽屉——挂在消息列表节点上
 *   （底边 = composer 顶边），高度固定比例、最高到消息区顶（吊顶），composer 保持可用
 * - PC 全屏：撑满整个聊天列（含 composer）
 *
 * 防误关不变量（画到一半丢失不可接受）：禁 mask 点击关闭、禁 ESC 关闭、无 antd 自带 X，
 * 唯一出口是 header 的「取消/完成」（取消的非空二次确认在 SketchCanvas 内）。
 * 注意：刻意不用 MobileDrawer——它的下拉关闭手势与防误关不变量冲突。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Drawer, Space, Tooltip } from 'antd'
import { Check, Maximize2, Minimize2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SketchMark } from '@mobi/shared'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { SKETCH_MARK, sketchFilename } from '@/domain/sketch/sketchFile'
import { SketchCanvas, type SketchCanvasHandle } from './SketchCanvas'

export interface SketchDrawerProps {
    open: boolean
    onClose: () => void
    /** 完成：产物为内嵌 scene 的单文件 PNG（调用方负责上传与附件装配） */
    onComplete: (png: Blob, filename: string, sketchMark: SketchMark) => void
    /** 重编辑载入的草图 PNG；缺省 = 空白画布 */
    initialSketch?: Blob | null
    /**
     * PC 停靠容器 = 消息列表节点：Drawer 从其底部向上弹出（底边紧贴 composer 顶边），
     * 高度 {@link DOCK_HEIGHT}、最高到容器顶（吊顶）。缺省挂 body 全屏兜底。
     */
    dockContainer?: HTMLElement | null
    /** PC 全屏容器 = 整个聊天列节点：全屏时撑满它（含 composer）。缺省挂 body。 */
    fullscreenContainer?: HTMLElement | null
}

/** PC 停靠高度（占消息列表容器比例）：从 composer 上方抽出，拉满即吊顶（容器顶 = 100%） */
const DOCK_HEIGHT = '70%'

export function SketchDrawer({
    open,
    onClose,
    onComplete,
    initialSketch = null,
    dockContainer = null,
    fullscreenContainer = null,
}: SketchDrawerProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()

    const [fullscreen, setFullscreen] = useState(false)
    // 重挂前从画布抢救出的内容，重挂后经 initialSketch 通道恢复（undo 历史不保留，可接受）
    const [remountSketch, setRemountSketch] = useState<Blob | null>(null)
    // 完成/取消导出在途：header 出口按钮统一禁用，防连点重复导出
    const [exporting, setExporting] = useState(false)
    const canvasRef = useRef<SketchCanvasHandle>(null)

    // 关闭即重置：下次打开回到默认停靠 + 不带回上次切换现场
    useEffect(() => {
        if (!open) {
            setRemountSketch(null)
            setFullscreen(false)
            setExporting(false)
        }
    }, [open])

    // PC 停靠/全屏切换换挂载点：key 强制重挂（antd Drawer 的 getContainer 不支持热切换）。
    // 重挂会重建 excalidraw 实例，先经 canvas 手柄导出内嵌 scene 的 PNG 再切换，恢复内容。
    const handleToggleFullscreen = useCallback(async () => {
        try {
            const png = (await canvasRef.current?.exportCurrent()) ?? null
            setRemountSketch(png)
            setFullscreen((v) => !v)
        } catch {
            // 导出失败不切换：宁可留在原容器也不能丢画布内容
        }
    }, [])

    // 完成：经 canvas 手柄导出（未就绪返回 null 则留在画布），文件名/标记在此装配
    const handleComplete = useCallback(async () => {
        setExporting(true)
        try {
            const png = await canvasRef.current?.complete()
            if (png) onComplete(png, sketchFilename(), SKETCH_MARK)
        } catch {
            // 导出失败留在画布，用户可重试
        } finally {
            setExporting(false)
        }
    }, [onComplete])

    // 挂载容器与形态（自上而下）：移动端 → body 全屏；PC 全屏 → 聊天列根；PC 停靠 → 消息列表；兜底 → body 全屏
    const drawerContainer = isMobile
        ? undefined
        : fullscreen
            ? (fullscreenContainer ?? undefined)
            : (dockContainer ?? undefined)

    // antd v6：width/height 已废弃（被忽略致面板塌缩），尺寸统一走 size（bottom drawer = 高度）
    const drawerProps = isMobile
        ? { placement: 'bottom' as const, size: '100dvh' as const }
        : fullscreen
            ? (fullscreenContainer
                ? { placement: 'bottom' as const, size: '100%' as const }
                : { placement: 'bottom' as const, size: '100dvh' as const })
            : dockContainer
                ? { placement: 'bottom' as const, size: DOCK_HEIGHT }
                : { placement: 'bottom' as const, size: '100dvh' as const }

    // 挂进自定义容器时 root/wrapper/mask 覆盖为 absolute——antd 默认 fixed 相对视口，
    // 挂进聊天列也会全屏盖页；absolute 相对容器（须 position:relative）才是停靠语义
    const dockedStyles = drawerContainer
        ? {
            root: { position: 'absolute' as const },
            wrapper: { position: 'absolute' as const },
            mask: { position: 'absolute' as const },
        }
        : undefined

    // 圆角：停靠/移动端 sheet 观感（四角）；PC 全屏撑满聊天列时收平（圆角会在列角露出背后内容）
    const rounded = !fullscreen || !fullscreenContainer

    const fullscreenLabel = t(fullscreen ? 'sketch.exitFullscreen' : 'sketch.fullscreen')
    return (
        <Drawer
            /* 容器/尺寸模式切换（PC 停靠 ↔ 全屏）强制重挂，excalidraw 画布随之重建。
             * key 只含模式不含 open——带上 open 会让关闭时整个 Drawer 换 key 重挂，
             * leave 动画直接跳过（表现为「突然消失」，2026-09-19 实踩） */
            key={isMobile ? 'mobile' : fullscreen ? 'fullscreen' : 'docked'}
            open={open}
            onClose={onClose}
            maskClosable={false}
            keyboard={false}
            closable={false}
            destroyOnHidden
            title={t('sketch.open')}
            extra={
                <Space size={4}>
                    {/* 仅 PC 可切全屏：移动端已全屏 */}
                    {!isMobile && (
                        <Tooltip title={fullscreenLabel}>
                            <Button
                                type="text"
                                size="small"
                                aria-label={fullscreenLabel}
                                icon={fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                                onClick={() => void handleToggleFullscreen()}
                            />
                        </Tooltip>
                    )}
                    <Tooltip title={t('common.cancel')}>
                        <Button
                            type="text"
                            size="small"
                            aria-label={t('common.cancel')}
                            icon={<X size={16} />}
                            disabled={exporting}
                            onClick={() => canvasRef.current?.requestCancel()}
                        />
                    </Tooltip>
                    <Tooltip title={t('sketch.complete')}>
                        <Button
                            type="text"
                            size="small"
                            aria-label={t('sketch.complete')}
                            icon={<Check size={16} />}
                            disabled={exporting}
                            onClick={() => void handleComplete()}
                        />
                    </Tooltip>
                </Space>
            }
            styles={{
                body: { padding: 0, display: 'flex', flexDirection: 'column' },
                // 遮罩只挡交互不改视觉：画板打开时背后的消息列表保持原样可读（用户指定纯透明）。
                // mask 与停靠 absolute 显式合并——...dockedStyles 浅展开会整体覆盖同 key。
                // wrapper 去掉 antd bottom 抽屉自带的向上投影——遮罩透明后它会显成一条阴影带
                mask: { background: 'transparent', ...(dockedStyles?.mask ?? {}) },
                wrapper: { boxShadow: 'none', ...(dockedStyles?.wrapper ?? {}) },
                // 圆角经 section + overflow hidden 裁切（wrapper 有过渡动画，圆角放这层会被拉伸）。
                // 细边框画边界：dark 下深色画布与页面底色接近，靠它确认画板范围。
                // root 去掉 focus ring：rc-drawer 打开时会 focus 面板，浏览器默认 outline
                // 会在整个停靠区域四周画一圈蓝框
                ...(rounded
                    ? {
                        section: {
                            borderRadius: 12,
                            overflow: 'hidden' as const,
                            border: '1px solid var(--ant-color-border)',
                        },
                    }
                    : {}),
                root: { outline: 'none', ...(dockedStyles?.root ?? {}) },
            }}
            {...drawerProps}
            {...(drawerContainer ? { getContainer: () => drawerContainer } : {})}
        >
            <div style={{ flex: 1, minHeight: 0 }}>
                {/* 压感默认恒为速度模拟（全设备手感一致）；触控笔真实压力通道留待用户偏好 */}
                <SketchCanvas
                    ref={canvasRef}
                    initialSketch={remountSketch ?? initialSketch}
                    onCancel={onClose}
                />
            </div>
        </Drawer>
    )
}
