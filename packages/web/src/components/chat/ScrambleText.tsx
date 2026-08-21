/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License at
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

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+'

/** 揭秘前沿的乱码缓冲区宽度 */
const SCRAMBLE_BUFFER = 2

interface ScrambleTextProps {
    /** 目标文本（newText） */
    text: string
    /** 起始文本（oldText），无值时自动生成随机初始文本 */
    previousText?: string
    /** 每步间隔毫秒 */
    speed?: number
}

/**
 * 文本过渡动画：从 previousText 通过前沿逐字过渡到 text
 * - 已揭秘字符：稳定展示
 * - 旧词稳定字符：保持展示
 * - 前沿缓冲区 + 超出旧文本：预生成乱码池字符
 */
export function ScrambleText({ text, previousText, speed = 40 }: ScrambleTextProps) {
    // 首挂载 text === previousText（如 AgentLoadingBubble 的首词）时无需过渡：
    // 直接全揭示——否则 revealed 停在 0，前 SCRAMBLE_BUFFER 个字符会永远
    // 显示乱码池字符（首词第一字符恒乱码的根因）
    const [revealed, setRevealed] = useState(() => (text === previousText ? text.length : 0))

    const prevTextRef = useRef(previousText ?? generateRandomString(text.length))
    const oldTextRef = useRef(previousText ?? generateRandomString(text.length))
    const scrambleRef = useRef(generateRandomString(Math.max(text.length, 64)))
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        if (text === prevTextRef.current) return

        clearInterval(intervalRef.current ?? undefined)
        oldTextRef.current = prevTextRef.current
        prevTextRef.current = text
        scrambleRef.current = generateRandomString(Math.max(text.length, 64))
        setRevealed(0)

        let pointer = 0
        intervalRef.current = setInterval(() => {
            pointer++
            for (let i = pointer; i < pointer + SCRAMBLE_BUFFER && i < text.length; i++) {
                scrambleRef.current = replaceChar(scrambleRef.current, i, randomChar())
            }
            if (pointer > text.length) {
                clearInterval(intervalRef.current ?? undefined)
                setRevealed(text.length)
                return
            }
            setRevealed(pointer)
        }, speed)

        return () => clearInterval(intervalRef.current ?? undefined)
    }, [text, speed])

    if (revealed >= text.length) {
        return <span>{text}</span>
    }

    const oldText = oldTextRef.current

    return (
        <span aria-hidden="true">
            {text.split('').map((char, i) => {
                if (char === ' ') return <span key={i}> </span>
                if (i < revealed) return <span key={i}>{char}</span>
                const isScrambled = i < revealed + SCRAMBLE_BUFFER || i >= oldText.length
                return <span key={i}>{isScrambled ? (scrambleRef.current[i] ?? randomChar()) : oldText[i]}</span>
            })}
        </span>
    )
}

function randomChar(): string {
    return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
}

function generateRandomString(length: number): string {
    return Array.from({ length }, () => randomChar()).join('')
}

function replaceChar(str: string, index: number, char: string): string {
    return str.substring(0, index) + char + str.substring(index + 1)
}