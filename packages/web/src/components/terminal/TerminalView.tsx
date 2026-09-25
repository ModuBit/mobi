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

import { useEffect, useRef, useState } from 'react'
import { Button, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { ReloadOutlined } from '@ant-design/icons'
import '@xterm/xterm/css/xterm.css'
import { useCachedInstance } from '@/core/hooks/useCachedInstance'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useIsDark } from '@/core/data/hooks/useIsDark'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import {
    createCachedTerminal,
    disposeCachedTerminal,
    type CachedTerminal,
    type TerminalStatus,
} from '@/components/terminal/cachedTerminal'
import { VirtualKeyBar } from './VirtualKeyBar'
import { VirtualKeyEditor } from './VirtualKeyEditor'

const { Text } = Typography

interface TerminalViewProps {
    sessionId: string
    terminalId: string
}

/** 断开态：需要展示重连遮罩的连接状态 */
function isDisconnected(status: TerminalStatus): boolean {
    return status === 'reconnecting' || status === 'error'
}

export default function TerminalView({ sessionId, terminalId }: TerminalViewProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const containerRef = useRef<HTMLDivElement>(null)
    const attachedRef = useRef(false)
    const [editorOpen, setEditorOpen] = useState(false)

    // session metadata：取版本（= mobi --version）、项目目录、git 分支用于 banner
    const { data: session } = useSession(sessionId)
    const metadata = session?.metadata
    // session 是否在线（CLI runner 已连接）；离线时不建终端 socket，避免被 hub 以 inactive 拒绝
    const active = session?.active === true
    // 终端主题跟随 web（亮/暗，system 模式实时响应 OS）
    const isDark = useIsDark()

    const { instance } = useCachedInstance<CachedTerminal>(
        `terminal:${sessionId}:${terminalId}`,
        () => createCachedTerminal({ sessionId, terminalId, initialActive: active }),
        disposeCachedTerminal,
    )

    // 订阅连接状态
    const [status, setStatus] = useState<TerminalStatus>(instance?.status ?? 'connecting')
    useEffect(() => {
        if (!instance) return
        setStatus(instance.status)
        return instance.subscribe(setStatus)
    }, [instance])

    // 重连 pending：点击「重连」后按钮转圈，直到状态离开点击时的值（如 ready 翻转 connected）
    // 才复位。唤醒场景 create 被拒（session_waking）会周期重试且同值不触发订阅回调——
    // pending 恰好覆盖整个唤醒窗口，失败重试期间不会闪回可点状态。
    const [reconnectPending, setReconnectPending] = useState(false)
    const statusAtReconnect = useRef<TerminalStatus | null>(null)
    useEffect(() => {
        if (statusAtReconnect.current !== null && status !== statusAtReconnect.current) {
            statusAtReconnect.current = null
            setReconnectPending(false)
        }
    }, [status])
    const handleReconnect = () => {
        if (!instance || reconnectPending) return
        statusAtReconnect.current = instance.status
        setReconnectPending(true)
        instance.reconnect()
    }

    // 欢迎横幅：metadata 就绪后写一次（showBanner 内部 once；cwd 未就绪跳过，等就绪再写）
    useEffect(() => {
        if (!instance) return
        instance.showBanner({
            version: metadata?.version,
            cwd: metadata?.path,
            gitBranch: metadata?.gitBranch,
        })
    }, [instance, metadata])

    // 主题切换：跟随 web 亮/暗，动态重绘终端（不丢历史、banner 文本随之重染）
    useEffect(() => {
        if (!instance) return
        instance.setTheme(isDark ? 'dark' : 'light')
    }, [instance, isDark])

    // 在线/离线控制 socket：离线断开（不 emit create），在线连
    useEffect(() => {
        if (!instance) return
        instance.setActive(active)
    }, [instance, active])

    // attach 缓存的 domNode 到可见容器
    useEffect(() => {
        if (!instance || !containerRef.current || attachedRef.current) return
        containerRef.current.appendChild(instance.domNode)
        attachedRef.current = true
        try {
            instance.fitAddon.fit()
        } catch {
            // 容器宽度为 0 时 fit 抛错，忽略
        }
        // 新建/切回 terminal tab 立即聚焦，可直接键盘输入
        instance.terminal.focus()
    }, [instance])

    // 监听可见容器尺寸变化 → fit（rAF 合并，避免拖拽期间连续全量重渲染 + 后端 resize 刷屏）
    useEffect(() => {
        if (!containerRef.current || !instance) return
        const el = containerRef.current
        let rafId: number | null = null
        const ro = new ResizeObserver(() => {
            if (rafId !== null) return // 一帧内多次 resize 只调度一次
            rafId = requestAnimationFrame(() => {
                rafId = null
                if (el.clientWidth > 0 && el.clientHeight > 0) {
                    try {
                        instance.fitAddon.fit()
                    } catch {
                        // 忽略
                    }
                }
            })
        })
        ro.observe(el)
        return () => {
            ro.disconnect()
            if (rafId !== null) cancelAnimationFrame(rafId)
        }
    }, [instance])

    // 组件卸载：移除 domNode（保留实例，不发 terminal:close，进程常驻）
    useEffect(() => {
        return () => {
            if (instance && instance.domNode.parentElement) {
                instance.domNode.parentElement.removeChild(instance.domNode)
            }
            attachedRef.current = false
        }
    }, [instance])

    const showMask = isDisconnected(status)

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div
                ref={containerRef}
                style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}
            >
                {showMask && (
                    <div
                        className="terminal-reconnect-mask"
                        style={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 10,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 12,
                        }}
                    >
                        <Text style={{ fontSize: 13 }}>
                            {t(`terminal.status.${status}`)}
                        </Text>
                        <Button
                            type="primary"
                            icon={<ReloadOutlined />}
                            loading={reconnectPending}
                            onClick={handleReconnect}
                        >
                            {t('terminal.reconnect')}
                        </Button>
                    </div>
                )}
            </div>
            {/* 移动端虚拟按键条：无物理键盘时触发 Ctrl+C/Esc/Tab/方向键等 */}
            {isMobile && (
                <>
                    <VirtualKeyBar
                        onSend={(data) => instance?.send(data)}
                        onEdit={() => setEditorOpen(true)}
                    />
                    <VirtualKeyEditor open={editorOpen} onClose={() => setEditorOpen(false)} />
                </>
            )}
        </div>
    )
}
