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
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

/** 终端连接状态机 */
export type TerminalStatus = 'connecting' | 'connected' | 'reconnecting' | 'error'

/** 终端主题模式（跟随 web 主题） */
export type TerminalThemeMode = 'dark' | 'light'

/** 暗色调色板（VSCode Dark+ 风格；bg/fg 与 web dark token 接近） */
const XTERM_DARK_THEME: ITheme = {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#ffffff',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
    blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
    brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
    brightCyan: '#29b8db', brightWhite: '#e5e5e5',
}

/** 亮色调色板（bg/fg 与 web light token 一致：#faf9f5 / #141413） */
const XTERM_LIGHT_THEME: ITheme = {
    background: '#faf9f5',
    foreground: '#141413',
    cursor: '#141413',
    cursorAccent: '#faf9f5',
    selectionBackground: '#c8c8c8',
    black: '#141413', red: '#cd3131', green: '#0a7d4f', yellow: '#b58900',
    blue: '#2472c8', magenta: '#bc3fbc', cyan: '#098a9e', white: '#faf9f5',
    brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#0a7d4f',
    brightYellow: '#b58900', brightBlue: '#2472c8', brightMagenta: '#d670d6',
    brightCyan: '#098a9e', brightWhite: '#ffffff',
}

/** 按模式取调色板 */
function xtermTheme(mode: TerminalThemeMode): ITheme {
    return mode === 'dark' ? XTERM_DARK_THEME : XTERM_LIGHT_THEME
}

/** MOBI ASCII art（box-drawing 字体，3 行；左侧两空格与信息行对齐）。
 *  不着色 → 用终端 default foreground，主题切换时随 theme.foreground 自动重染（亮暗均醒目） */
const MOBI_ART = [
    '  ╭┬╮╭─╮╭╮ ╷\r\n',
    '  ││││ │├┴╮│\r\n',
    '  ╵ ╵╰─╯╰─╯╵\r\n',
].join('')

/** 欢迎横幅信息（来自 session.metadata） */
export interface BannerInfo {
    /** mobi 版本（= `mobi --version`，session.metadata.version） */
    version?: string
    /** 项目目录 cwd（session.metadata.path） */
    cwd?: string
    /** Git 分支（可选，session.metadata.gitBranch） */
    gitBranch?: string
}

/**
 * 构建欢迎横幅：MOBI ASCII art + 版本 + 项目目录（含 git 分支）。
 * 由 showBanner 在 metadata 就绪后写入一次；reconnect 不重复。
 */
export function buildBanner({ version, cwd, gitBranch }: BannerInfo): string {
    const lines: string[] = ['\r\n', MOBI_ART]
    if (version) {
        // MOBI 用 default foreground（随主题），- version 用灰（亮暗均可见）
        lines.push(`  MOBI \x1b[90m- ${version}\x1b[0m\r\n`)
    }
    if (cwd) {
        const branchSuffix = gitBranch ? ` \x1b[90m(git:${gitBranch})\x1b[0m` : ''
        lines.push(`\x1b[90m  ${cwd}\x1b[0m${branchSuffix}\r\n`)
    }
    lines.push('\r\n')
    return lines.join('')
}

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
    /** 写入欢迎横幅（metadata 就绪后调用；cwd 未就绪跳过，仅写一次） */
    showBanner: (info: BannerInfo) => void
    /** 切换终端主题（跟随 web 亮/暗），动态重绘不丢历史 */
    setTheme: (mode: TerminalThemeMode) => void
    /** 直接发送字节序列到 PTY（虚拟按键用，不经 xterm 输入焦点） */
    send: (data: string) => void
    /** 控制 socket 连接（离线断开避免被拒、在线重连） */
    setActive: (active: boolean) => void
    /** 内部销毁钩子（断 socket + 销毁 xterm）；仅 clearCachedInstance 调用 */
    dispose: () => void
}

interface CreateOptions {
    sessionId: string
    terminalId: string
    /** 初始是否建连（session 离线时传 false，延迟到 active 再连）；默认 true */
    initialActive?: boolean
}

/**
 * 创建一个常驻终端实例（xterm + socket）。
 * socket 断开不杀后端进程（TerminalManager 常驻）；重连 re-attach。
 * dispose 时断开 socket 并销毁 xterm（仅 clearCachedInstance 触发）。
 */
export function createCachedTerminal({ sessionId, terminalId, initialActive = true }: CreateOptions): CachedTerminal {
    const domNode = document.createElement('div')
    domNode.style.cssText = `width:100%;height:100%;background:${XTERM_DARK_THEME.background};padding:4px;overflow:hidden;`

    const terminal = new Terminal({
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Monaco, Menlo, Consolas, monospace',
        theme: XTERM_DARK_THEME,
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
        const terminalOrigin = __MOBI_HUB_URL__ ?? window.location.origin
        socket = io(`${terminalOrigin}/terminal`, {
            // httpOnly cookie（mobi_token）按 host 携带；dev 端口不同仍可直连 Hub，production 保持同源
            transports: ['websocket'],
            path: '/socket.io',
            // 离线 session 不主动建连（setActive(true) 后再 connect），避免被 hub 以 inactive 拒绝
            autoConnect: initialActive,
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
            socket!.emit('terminal:create', { sessionId, terminalId, cols, rows })
            isOpen = true
            setStatus('connected')
            terminal.write('\x1b[32m[Terminal connected]\x1b[0m\r\n')
        })
        // terminal:ready：hub 处理完 terminal:create 后回传，标志终端会话真正建立。
        // reconnect（socket 仍连着、重发 create）时不会触发 connect 事件，靠 ready 恢复 connected 态。
        socket.on('terminal:ready', (d: { sessionId: string; terminalId: string }) => {
            if (d.sessionId === sessionId && d.terminalId === terminalId) {
                isOpen = true
                setStatus('connected')
            }
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
                isOpen = false // 复位：create 被拒/CLI 断开时不再发 terminal:write，避免击键静默丢弃
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
            // socket 连着（如 CLI 断开导致的 error）：重发 create 重新打开终端会话。
            // hub 端同一 socket 重注册会先清旧 entry（避免 "already in use"），CLI 复用已存在的 PTY。
            // 成功后 hub 回传 terminal:ready → setStatus('connected')。
            const { cols, rows } = terminal
            socket.emit('terminal:create', { sessionId, terminalId, cols, rows })
            isOpen = true
        } else {
            // socket 断开：主动重连，connect 事件会自动重发 terminal:create
            socket.connect()
        }
    }

    // 欢迎横幅：仅写一次（跟实例生命周期，跨 tab 切换/重连不重复）。
    // cwd 未就绪时跳过，等 TerminalView 拿到 session.metadata 后再写。
    let bannerShown = false
    const showBanner = (info: BannerInfo) => {
        if (bannerShown) return
        if (!info.cwd) return
        terminal.write(buildBanner(info))
        bannerShown = true
    }

    // 主题切换：动态改 xterm theme + domNode 背景，立即重绘不丢历史
    const setTheme = (mode: TerminalThemeMode) => {
        const t = xtermTheme(mode)
        terminal.options.theme = t
        domNode.style.background = t.background ?? ''
    }

    // 直接发送字节到 PTY（虚拟按键用；与 onData 路径一致，但无需终端聚焦）
    const send = (data: string) => {
        if (socket?.connected && isOpen) {
            socket.emit('terminal:write', { sessionId, terminalId, data })
        }
    }

    // 控制 socket 连接：离线 session 断开（不 emit create，避免被 hub 以 inactive 拒绝），在线连
    const setActive = (active: boolean) => {
        if (!socket) return
        if (active) socket.connect()
        else {
            isOpen = false
            socket.disconnect()
        }
    }

    // 移动端触屏滚动：@xterm/xterm 6.0.0 公开 Terminal 的滚动（SmoothScrollableElement）
    // 只监听 MOUSE_WHEEL，触摸 Gesture 被裁剪（Widget 仅有 ignoreGesture 无 addTarget；
    // MouseService touch 在 master 才有）。故移动端需自行把 touch 位移转 scrollLines。
    // 累积位移到约一行高度后滚动（带余量防抖动）；alt buffer（vim/less 无 scrollback）不拦截。
    const ROW_PX = 18 // 近似行高（fontSize 14 + 行距）
    let lastTouchY = 0
    let scrollAcc = 0
    const onTouchStart = (e: TouchEvent) => {
        // 无论几指：以首指重置基准（多指手势开始清累积，避免残留）
        lastTouchY = e.touches[0]?.clientY ?? lastTouchY
        scrollAcc = 0
    }
    const onTouchEnd = (e: TouchEvent) => {
        // 多指手势结束、剩单指：以剩余指重置基准，避免抬指后用旧基准大跳
        if (e.touches.length === 1) {
            lastTouchY = e.touches[0].clientY
            scrollAcc = 0
        }
    }
    const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length !== 1) return
        // 无 scrollback（alt buffer 如 vim/less，或刚开无历史）不拦截，避免困住用户
        if (terminal.buffer.active.length <= terminal.rows) return
        const y = e.touches[0].clientY
        scrollAcc += lastTouchY - y // 上滑为正（看更新内容）、下滑为负（看更早历史）
        lastTouchY = y
        const lines = Math.trunc(scrollAcc / ROW_PX)
        if (lines !== 0) {
            terminal.scrollLines(lines)
            scrollAcc -= lines * ROW_PX
            e.preventDefault() // 阻止页面整体滚动，让终端接管
        }
    }
    domNode.addEventListener('touchstart', onTouchStart, { passive: true })
    domNode.addEventListener('touchmove', onTouchMove, { passive: false })
    domNode.addEventListener('touchend', onTouchEnd, { passive: true })

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
        // 移除触屏滚动监听（terminal.dispose 不清自己加的 listener）
        domNode.removeEventListener('touchstart', onTouchStart)
        domNode.removeEventListener('touchmove', onTouchMove)
        domNode.removeEventListener('touchend', onTouchEnd)
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
        showBanner,
        setTheme,
        send,
        setActive,
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
