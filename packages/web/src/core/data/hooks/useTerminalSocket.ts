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

import { useEffect, useRef, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useAuthStore } from '@/core/data/stores/authStore'

interface UseTerminalSocketOptions {
    sessionId: string
    terminalId: string
    onData: (data: string) => void
    onExit?: (code?: number) => void
    onOpen?: () => void
}

export function useTerminalSocket({
    sessionId,
    terminalId,
    onData,
    onExit,
    onOpen,
}: UseTerminalSocketOptions) {
    const { token } = useAuthStore()
    const socketRef = useRef<Socket | null>(null)
    const isOpenRef = useRef(false)

    // 使用 ref 存储回调，避免引用变化导致 effect 重执行
    const onDataRef = useRef(onData)
    const onExitRef = useRef(onExit)
    const onOpenRef = useRef(onOpen)
    onDataRef.current = onData
    onExitRef.current = onExit
    onOpenRef.current = onOpen

    useEffect(() => {
        if (!token) return

        // 创建 WebSocket 连接（使用当前页面的 origin）
        const socket = io(window.location.origin, {
            auth: { token },
            transports: ['websocket'],
            path: '/socket.io',
        })
        socketRef.current = socket

        // 监听终端输出
        socket.on('terminal:output', (data: { sessionId: string; terminalId: string; data: string }) => {
            if (data.sessionId === sessionId && data.terminalId === terminalId) {
                onDataRef.current(data.data)
            }
        })

        // 监听终端退出
        socket.on('terminal:exit', (data: { sessionId: string; terminalId: string; code?: number }) => {
            if (data.sessionId === sessionId && data.terminalId === terminalId) {
                onExitRef.current?.(data.code)
                isOpenRef.current = false
            }
        })

        // 监听连接成功
        socket.on('connect', () => {
            console.log('Terminal socket connected')
        })

        // 监听连接错误
        socket.on('connect_error', (error) => {
            console.error('Terminal socket error:', error)
        })

        return () => {
            socket.disconnect()
            socketRef.current = null
        }
    }, [token, sessionId, terminalId])

    // 打开终端
    const open = useCallback((cols: number, rows: number, cwd?: string) => {
        if (socketRef.current && !isOpenRef.current) {
            socketRef.current.emit('terminal:open', {
                sessionId,
                terminalId,
                cols,
                rows,
                cwd,
            })
            isOpenRef.current = true
            onOpenRef.current?.()
        }
    }, [sessionId, terminalId])

    // 写入数据
    const write = useCallback((data: string) => {
        if (socketRef.current && isOpenRef.current) {
            socketRef.current.emit('terminal:write', {
                sessionId,
                terminalId,
                data,
            })
        }
    }, [sessionId, terminalId])

    // 调整大小
    const resize = useCallback((cols: number, rows: number) => {
        if (socketRef.current && isOpenRef.current) {
            socketRef.current.emit('terminal:resize', {
                sessionId,
                terminalId,
                cols,
                rows,
            })
        }
    }, [sessionId, terminalId])

    // 关闭终端
    const close = useCallback(() => {
        if (socketRef.current && isOpenRef.current) {
            socketRef.current.emit('terminal:close', {
                sessionId,
                terminalId,
            })
            isOpenRef.current = false
        }
    }, [sessionId, terminalId])

    return { open, write, resize, close }
}
