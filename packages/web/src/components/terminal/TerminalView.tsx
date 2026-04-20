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

import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTerminalSocket } from '@/core/data/hooks/useTerminalSocket'
import { Button, Typography, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ReloadOutlined } from '@ant-design/icons'
import '@xterm/xterm/css/xterm.css'

const { Text } = Typography
const { useToken } = antTheme

interface TerminalViewProps {
    sessionId: string
}

const TERMINAL_ID = 'main'

export default function TerminalView({ sessionId }: TerminalViewProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const hasOpenedRef = useRef(false)
    const { token } = useToken()
    const { t } = useTranslation()

    const { open, write, resize, close } = useTerminalSocket({
        sessionId,
        terminalId: TERMINAL_ID,
        onData: (data) => {
            terminalRef.current?.write(data)
        },
        onExit: (code) => {
            // 终端消息保持原语言，因为它们是系统级的
            terminalRef.current?.write(`\r\n\x1b[31m[Process exited, code: ${code}]\x1b[0m\r\n`)
        },
        onOpen: () => {
            terminalRef.current?.write('\x1b[32m[Terminal connected]\x1b[0m\r\n')
        }
    })

    // 初始化终端
    useEffect(() => {
        if (!containerRef.current || terminalRef.current) return

        const terminal = new Terminal({
            fontSize: 14,
            fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Monaco, Menlo, Consolas, monospace',
            theme: {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
                cursor: '#ffffff',
                cursorAccent: '#1e1e1e',
                selectionBackground: '#264f78',
                black: '#000000',
                red: '#cd3131',
                green: '#0dbc79',
                yellow: '#e5e510',
                blue: '#2472c8',
                magenta: '#bc3fbc',
                cyan: '#11a8cd',
                white: '#e5e5e5',
                brightBlack: '#666666',
                brightRed: '#f14c4c',
                brightGreen: '#23d18b',
                brightYellow: '#f5f543',
                brightBlue: '#3b8eea',
                brightMagenta: '#d670d6',
                brightCyan: '#29b8db',
                brightWhite: '#e5e5e5',
            },
            cursorBlink: true,
            cursorStyle: 'block',
            scrollback: 1000,
            allowProposedApi: true,
        })

        const fitAddon = new FitAddon()
        const webLinksAddon = new WebLinksAddon()

        terminal.loadAddon(fitAddon)
        terminal.loadAddon(webLinksAddon)
        terminal.open(containerRef.current)

        terminalRef.current = terminal
        fitAddonRef.current = fitAddon

        // 监听用户输入
        terminal.onData((data) => {
            write(data)
        })

        // 监听 resize
        terminal.onResize(({ cols, rows }) => {
            resize(cols, rows)
        })

        return () => {
            close()
            terminal.dispose()
            terminalRef.current = null
            fitAddonRef.current = null
        }
    }, [sessionId, write, resize, close])

    // 处理容器尺寸变化
    useEffect(() => {
        if (!containerRef.current || !fitAddonRef.current) return

        const resizeObserver = new ResizeObserver(() => {
            if (fitAddonRef.current && terminalRef.current) {
                fitAddonRef.current.fit()
            }
        })

        resizeObserver.observe(containerRef.current)

        return () => {
            resizeObserver.disconnect()
        }
    }, [])

    // 打开终端会话（首次）
    useEffect(() => {
        if (!terminalRef.current || !fitAddonRef.current || hasOpenedRef.current) return

        const terminal = terminalRef.current
        const fitAddon = fitAddonRef.current

        // 延迟打开以确保容器已渲染
        const timer = setTimeout(() => {
            fitAddon.fit()
            const { cols, rows } = terminal
            open(cols, rows)
            hasOpenedRef.current = true
        }, 100)

        return () => {
            clearTimeout(timer)
        }
    }, [open])

    const handleReconnect = () => {
        if (terminalRef.current && fitAddonRef.current) {
            terminalRef.current.clear()
            fitAddonRef.current.fit()
            const { cols, rows } = terminalRef.current
            hasOpenedRef.current = false
            open(cols, rows)
            hasOpenedRef.current = true
        }
    }

    return (
        <div style={{ height: 'calc(100vh - 130px)', display: 'flex', flexDirection: 'column' }}>
            {/* 工具栏 */}
            <div style={{
                padding: '8px 16px',
                borderBottom: `1px solid ${token.colorBorder}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: token.colorBgLayout
            }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('terminal.title')} {sessionId.slice(0, 8)}
                </Text>
                <Button
                    icon={<ReloadOutlined />}
                    size="small"
                    onClick={handleReconnect}
                >
                    {t('terminal.reconnect')}
                </Button>
            </div>

            {/* 终端容器 */}
            <div
                ref={containerRef}
                style={{
                    flex: 1,
                    background: '#1e1e1e',
                    padding: 4,
                    overflow: 'hidden'
                }}
            />
        </div>
    )
}
