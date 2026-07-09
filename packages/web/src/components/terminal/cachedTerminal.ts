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

/** 终端连接状态机 */
export type TerminalStatus = 'connecting' | 'connected' | 'reconnecting' | 'error'

/** 缓存的终端实例：xterm + 插件 + 独立 DOM 节点 + socket */
export interface CachedTerminal {
    terminal: Terminal
    fitAddon: FitAddon
    domNode: HTMLDivElement
    /** 当前连接状态 */
    status: TerminalStatus
    /** 订阅状态变化，返回取消订阅函数 */
    subscribe: (listener: (s: TerminalStatus) => void) => () => void
    /** 重连：保留历史，写分隔横幅并重新 open 终端会话 */
    reconnect: () => void
    /** 内部销毁钩子（断 socket + 销毁 xterm）；仅 clearCachedInstance 调用 */
    dispose: () => void
}

interface CreateOptions {
    sessionId: string
    terminalId: string
}

/**
 * 创建一个常驻终端实例（xterm + socket）。
 * socket 断开不杀后端进程（TerminalManager 常驻）；重连 re-attach。
 * dispose 时断开 socket 并销毁 xterm（仅 clearCachedInstance 触发）。
 */
export function createCachedTerminal({ sessionId, terminalId }: CreateOptions): CachedTerminal {
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

    // 连接状态机：connecting(初始) → connected | reconnecting | error
    let status: TerminalStatus = 'connecting'
    const listeners = new Set<(s: TerminalStatus) => void>()
    const setStatus = (next: TerminalStatus) => {
        if (status === next) return
        status = next
        listeners.forEach((l) => l(status))
    }
    const subscribe = (listener: (s: TerminalStatus) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
    }

    const wireSocket = () => {
        socket = io(`${window.location.origin}/terminal`, {
            // 同源 httpOnly cookie（mobi_token）自动携带，/terminal namespace 读 cookie（刷新不丢）
            transports: ['websocket'],
            path: '/socket.io',
        })

        socket.on('terminal:output', (d: { sessionId: string; terminalId: string; data: string }) => {
            if (d.sessionId === sessionId && d.terminalId === terminalId) {
                // 终端场景：output 直接写屏，不依赖外部 onData 回调新鲜度
                terminal.write(d.data)
            }
        })
        socket.on('terminal:exit', (d: { sessionId: string; terminalId: string; code?: number }) => {
            if (d.sessionId === sessionId && d.terminalId === terminalId) {
                // exit 横幅直接写屏，外部无需感知（进程退出由后端 TerminalManager 管理）
                terminal.write(`\r\n\x1b[31m[Process exited, code: ${d.code}]\x1b[0m\r\n`)
                isOpen = false
            }
        })

        terminal.onData((data) => {
            if (socket?.connected && isOpen) {
                socket.emit('terminal:write', { sessionId, terminalId, data })
            }
        })
        terminal.onResize(({ cols, rows }) => {
            if (socket?.connected && isOpen) {
                socket.emit('terminal:resize', { sessionId, terminalId, cols, rows })
            }
        })

        socket.on('connect', () => {
            const { cols, rows } = terminal
            socket!.emit('terminal:open', { sessionId, terminalId, cols, rows })
            isOpen = true
            setStatus('connected')
            terminal.write('\x1b[32m[Terminal connected]\x1b[0m\r\n')
        })
        // 断线/重连：进入 reconnecting 态（disconnect 不 clear，等 reconnect 横幅分隔）
        socket.on('disconnect', () => setStatus('reconnecting'))
        socket.on('reconnect_attempt', () => setStatus('reconnecting'))
        socket.on('connect_error', () => setStatus('error'))
        // terminal:error：hub 内部 emit（emitTerminalError/onIdle/cleanup）普遍只带
        // { terminalId, message }，不带 sessionId（仅 CLI 转发路径带）；每个实例独占
        // socket，socketId 天然隔离事件，故只按 terminalId 过滤，sessionId 标可选如实反映 hub 违约
        socket.on('terminal:error', (d: { terminalId: string; message: string; sessionId?: string }) => {
            if (d.terminalId === terminalId) {
                setStatus('error')
                terminal.write(`\r\n\x1b[31m[${d.message}]\x1b[0m\r\n`)
            }
        })
    }

    wireSocket()

    const reconnect = () => {
        // 不 clear：保留历史；写分隔横幅
        terminal.write('\r\n\x1b[90m--- reconnected ---\x1b[0m\r\n')
        if (!socket) return
        if (socket.connected) {
            const { cols, rows } = terminal
            socket.emit('terminal:open', { sessionId, terminalId, cols, rows })
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
                socket.emit('terminal:close', { sessionId, terminalId: terminalId })
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

    return {
        terminal,
        fitAddon,
        domNode,
        // getter：暴露状态机当前值（status 是闭包内的 let，需 live 反映）
        get status(): TerminalStatus {
            return status
        },
        subscribe,
        reconnect,
        dispose,
    }
}

/**
 * dispose：断开 socket + 销毁 xterm。
 * 仅由 clearCachedInstance（session 删除/登出）触发；组件卸载不调用。
 */
export function disposeCachedTerminal(inst: CachedTerminal): void {
    inst.dispose()
}
