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
 * - PC：默认停靠聊天列容器（覆盖消息列表与输入区），可一键切全屏
 *
 * 防误关不变量（画到一半丢失不可接受）：禁 mask 点击关闭、禁 ESC 关闭、无右上角 X，
 * 唯一出口是画布内显式「完成/取消」（取消的非空二次确认在 SketchCanvas 内）。
 * 注意：刻意不用 MobileDrawer——它的下拉关闭手势与防误关不变量冲突。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Drawer, Space, Switch, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SketchMark } from '@mobi/shared'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { SketchCanvas, type SketchCanvasHandle } from './SketchCanvas'

export interface SketchDrawerProps {
    open: boolean
    onClose: () => void
    /** 完成：产物为内嵌 scene 的单文件 PNG（调用方负责上传与附件装配） */
    onComplete: (png: Blob, filename: string, sketchMark: SketchMark) => void
    /** 重编辑载入的草图 PNG；缺省 = 空白画布 */
    initialSketch?: Blob | null
    /** PC 端停靠容器（聊天列 DOM 节点）；缺省挂 body（全屏兜底） */
    dockContainer?: HTMLElement | null
}

export function SketchDrawer({ open, onClose, onComplete, initialSketch = null, dockContainer = null }: SketchDrawerProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()

    // 压感模式：速度模拟为默认（全设备手感一致，PoC 真机验证）；关闭后触控笔走真实压力。
    // 会话级 UI 偏好，不持久化（触控笔人群可后续入用户偏好存储）。
    const [simulatePressure, setSimulatePressure] = useState(true)
    const [fullscreen, setFullscreen] = useState(false)
    // 重挂前从画布抢救出的内容，重挂后经 initialSketch 通道恢复（undo 历史不保留，可接受）
    const [remountSketch, setRemountSketch] = useState<Blob | null>(null)
    const canvasRef = useRef<SketchCanvasHandle>(null)

    // 关闭即重置：下次打开回到默认停靠 + 不带回上次切换现场
    useEffect(() => {
        if (!open) {
            setRemountSketch(null)
            setFullscreen(false)
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

    const drawerContainer = useMemo(() => {
        if (isMobile || fullscreen) return undefined // undefined = body
        return dockContainer ?? undefined
    }, [isMobile, fullscreen, dockContainer])

    const drawerProps = isMobile || fullscreen
        ? { placement: 'bottom' as const, height: '100dvh' }
        : { placement: 'right' as const, width: '100%', height: '100%' }

    return (
        <Drawer
            /* 容器/尺寸模式切换（PC 停靠 ↔ 全屏）强制重挂，excalidraw 画布随之重建 */
            key={`${isMobile ? 'mobile' : fullscreen ? 'fullscreen' : 'docked'}-${open}`}
            open={open}
            onClose={onClose}
            maskClosable={false}
            keyboard={false}
            closable={false}
            destroyOnHidden
            title={t('sketch.open')}
            extra={
                <Space size={12}>
                    {/* 仅 PC 停靠模式可切全屏：移动端已全屏，全屏模式供退出 */}
                    {!isMobile && (
                        <Button
                            size="small"
                            onClick={() => void handleToggleFullscreen()}
                        >
                            {t(fullscreen ? 'sketch.exitFullscreen' : 'sketch.fullscreen')}
                        </Button>
                    )}
                    <Tooltip title={t(simulatePressure ? 'sketch.pressureSimulated' : 'sketch.pressureReal')}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <span style={{ fontSize: 12 }}>{t(simulatePressure ? 'sketch.pressureSimulated' : 'sketch.pressureReal')}</span>
                            <Switch
                                size="small"
                                checked={simulatePressure}
                                onChange={setSimulatePressure}
                                aria-label={t('sketch.pressureSimulated')}
                            />
                        </label>
                    </Tooltip>
                </Space>
            }
            styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
            {...drawerProps}
            {...(drawerContainer ? { getContainer: () => drawerContainer } : {})}
        >
            <div style={{ flex: 1, minHeight: 0 }}>
                <SketchCanvas
                    ref={canvasRef}
                    initialSketch={remountSketch ?? initialSketch}
                    simulatePressure={simulatePressure}
                    onComplete={onComplete}
                    onCancel={onClose}
                />
            </div>
        </Drawer>
    )
}
