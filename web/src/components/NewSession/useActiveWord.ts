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

import { useState, useCallback, useEffect, useRef } from 'react'
import { findActiveWord, type ActiveWord } from '@/utils/findActiveWord'

/**
 * Hook 用于检测输入框中光标所在位置的活跃单词
 * @param text 输入文本
 * @param cursorPosition 光标位置
 * @returns 活跃单词信息
 */
export function useActiveWord(
    text: string,
    cursorPosition: number
): ActiveWord | null {
    const [activeWord, setActiveWord] = useState<ActiveWord | null>(null)

    // 使用 ref 来存储最新的参数，避免频繁触发 useEffect
    const textRef = useRef(text)
    const cursorRef = useRef(cursorPosition)

    useEffect(() => {
        textRef.current = text
        cursorRef.current = cursorPosition
    }, [text, cursorPosition])

    useEffect(() => {
        const word = findActiveWord(textRef.current, cursorRef.current)
        setActiveWord(word)
    }, [text, cursorPosition])

    return activeWord
}

/**
 * Hook 用于跟踪输入框的光标位置
 * @returns [cursorPosition, setCursorPosition, handleSelectionChange]
 */
export function useCursorPosition(): [
    number,
    React.Dispatch<React.SetStateAction<number>>,
    (event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => void
] {
    const [cursorPosition, setCursorPosition] = useState(0)

    const handleSelectionChange = useCallback(
        (event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            const target = event.currentTarget
            setCursorPosition(target.selectionStart ?? 0)
        },
        []
    )

    return [cursorPosition, setCursorPosition, handleSelectionChange]
}
