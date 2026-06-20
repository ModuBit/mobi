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

import { io, type Socket } from 'socket.io-client'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useAuthStore } from '@/core/data/stores/authStore'

const TERMINAL_ID = 'main'

/** 缓存的终端实例：xterm + 插件 + 独立 DOM 节点 + socket */
export interface CachedTerminal {
    terminal: Terminal
    fitAddon: FitAddon
    domNode: HTMLDivElement
    /** 重连：清屏并重新 open 终端会话 */
    reconnect: () => void
    /** 内部销毁钩子（断 socket + 销毁 xterm）；仅 clearCachedInstance 调用 */
    dispose: () => void
}

interface CreateOptions {
    sessionId: string
}

/**
 * 创建一个常驻终端实例（xterm + socket）。
 * socket 断开不杀后端进程（TerminalManager 常驻）；重连 re-attach。
 * dispose 时断开 socket 并销毁 xterm（仅 clearCachedInstance 触发）。
 */
export function createCachedTerminal({ sessionId }: CreateOptions): CachedTerminal {
    const { token } = useAuthStore.getState()

    const domNode = document.createElement('div')
    domNode.style.cssText = 'width:100%;height:100%;background:#1e1e1e;padding:4px;overflow:hidden;'

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
    terminal.open(domNode)

    let socket: Socket | null = null
    let isOpen = false

    const wireSocket = () => {
        socket = io(window.location.origin, {
            auth: { token },
            transports: ['websocket'],
            path: '/socket.io',
        })

        socket.on('terminal:output', (d: { sessionId: string; terminalId: string; data: string }) => {
            if (d.sessionId === sessionId && d.terminalId === TERMINAL_ID) {
                // 终端场景：output 直接写屏，不依赖外部 onData 回调新鲜度
                terminal.write(d.data)
            }
        })
        socket.on('terminal:exit', (d: { sessionId: string; terminalId: string; code?: number }) => {
            if (d.sessionId === sessionId && d.terminalId === TERMINAL_ID) {
                // exit 横幅直接写屏，外部无需感知（进程退出由后端 TerminalManager 管理）
                terminal.write(`\r\n\x1b[31m[Process exited, code: ${d.code}]\x1b[0m\r\n`)
                isOpen = false
            }
        })

        terminal.onData((data) => {
            if (socket?.connected && isOpen) {
                socket.emit('terminal:write', { sessionId, terminalId: TERMINAL_ID, data })
            }
        })
        terminal.onResize(({ cols, rows }) => {
            if (socket?.connected && isOpen) {
                socket.emit('terminal:resize', { sessionId, terminalId: TERMINAL_ID, cols, rows })
            }
        })

        socket.on('connect', () => {
            const { cols, rows } = terminal
            socket!.emit('terminal:open', { sessionId, terminalId: TERMINAL_ID, cols, rows })
            isOpen = true
            terminal.write('\x1b[32m[Terminal connected]\x1b[0m\r\n')
        })
    }

    wireSocket()

    const reconnect = () => {
        terminal.clear()
        if (!socket) return
        if (socket.connected) {
            const { cols, rows } = terminal
            socket.emit('terminal:open', { sessionId, terminalId: TERMINAL_ID, cols, rows })
            isOpen = true
        } else {
            // 掉线窗口期：主动重连，connect 事件会自动重发 terminal:open
            socket.connect()
        }
    }

    // 内部销毁：先通知后端关闭 PTY（terminal:close），再移除监听（避免 disconnect 重连瞬间
    // 触发回调向已销毁 xterm 写屏），再断 socket，最后销毁 xterm。
    // 仅由 disposeCachedTerminal → clearCachedInstance（session 删除/登出）触发。
    const dispose = () => {
        try {
            // 关闭后端 PTY（组件卸载不发，仅真正销毁实例时发）
            if (socket?.connected) {
                socket.emit('terminal:close', { sessionId, terminalId: TERMINAL_ID })
            }
            socket?.removeAllListeners()
            socket?.disconnect()
        } catch {
            // 忽略
        }
        socket = null
        isOpen = false
        try {
            terminal.dispose()
        } catch {
            // 忽略
        }
    }

    return { terminal, fitAddon, domNode, reconnect, dispose }
}

/**
 * dispose：断开 socket + 销毁 xterm。
 * 仅由 clearCachedInstance（session 删除/登出）触发；组件卸载不调用。
 */
export function disposeCachedTerminal(inst: CachedTerminal): void {
    inst.dispose()
}
