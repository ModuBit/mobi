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

/**
 * 自动完成建议项
 */
export interface Suggestion {
    /** 唯一标识 */
    key: string
    /** 显示文本 */
    text: string
    /** 标签（用于搜索匹配） */
    label: string
    /** 描述（可选） */
    description?: string
    /** 展开内容（可选） */
    content?: string
    /** 来源类型 */
    source?: 'builtin' | 'user' | 'plugin' | 'project'
}

interface SuggestionOptions {
    /** 是否限制选择范围 */
    clampSelection?: boolean
    /** 是否自动选择第一项 */
    autoSelectFirst?: boolean
    /** 是否循环选择 */
    wrapAround?: boolean
    /** 是否允许空查询 */
    allowEmptyQuery?: boolean
}

/**
 * 简单的值同步类，确保只处理最新的查询
 */
class ValueSync<T> {
    private latestValue: T | undefined
    private hasValue = false
    private processing = false
    private stopped = false
    private command: (value: T) => Promise<void>

    constructor(command: (value: T) => Promise<void>) {
        this.command = command
    }

    setValue(value: T): void {
        if (this.stopped) {
            this.stopped = false
        }
        this.latestValue = value
        this.hasValue = true
        if (!this.processing) {
            this.processing = true
            this.doSync()
        }
    }

    stop(): void {
        this.stopped = true
    }

    private async doSync(): Promise<void> {
        while (this.hasValue && !this.stopped) {
            const value = this.latestValue!
            this.hasValue = false
            try {
                await this.command(value)
            } catch (e) {
                console.error('ValueSync error:', e)
            }
        }
        this.processing = false
    }
}

/**
 * 管理自动完成建议的 Hook
 * @param query 查询字符串（null 表示不显示建议）
 * @param handler 获取建议的函数
 * @param options 配置选项
 * @returns [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions]
 */
export function useActiveSuggestions(
    query: string | null,
    handler: (query: string) => Promise<Suggestion[]>,
    options: SuggestionOptions = {}
): readonly [
    Suggestion[],
    number,
    () => void,
    () => void,
    () => void
] {
    const {
        clampSelection = true,
        autoSelectFirst = true,
        wrapAround = true,
        allowEmptyQuery = false
    } = options

    const [state, setState] = useState<{
        suggestions: Suggestion[]
        selected: number
    }>({
        suggestions: [],
        selected: -1
    })

    const moveUp = useCallback(() => {
        setState((prev) => {
            if (prev.suggestions.length === 0) return prev

            if (prev.selected <= 0) {
                if (wrapAround) {
                    return { ...prev, selected: prev.suggestions.length - 1 }
                }
                return { ...prev, selected: 0 }
            }
            return { ...prev, selected: prev.selected - 1 }
        })
    }, [wrapAround])

    const moveDown = useCallback(() => {
        setState((prev) => {
            if (prev.suggestions.length === 0) return prev

            if (prev.selected >= prev.suggestions.length - 1) {
                if (wrapAround) {
                    return { ...prev, selected: 0 }
                }
                return { ...prev, selected: prev.suggestions.length - 1 }
            }
            if (prev.selected < 0) {
                return { ...prev, selected: 0 }
            }
            return { ...prev, selected: prev.selected + 1 }
        })
    }, [wrapAround])

    const clear = useCallback(() => {
        setState({ suggestions: [], selected: -1 })
    }, [])

    const handlerRef = useRef(handler)
    handlerRef.current = handler

    const syncRef = useRef<ValueSync<string | null> | null>(null)

    useEffect(() => {
        const sync = new ValueSync<string | null>(async (nextQuery) => {
            if (nextQuery === null || (!allowEmptyQuery && nextQuery === '')) return

            const suggestions = await handlerRef.current(nextQuery)

            setState((prev) => {
                if (clampSelection) {
                    let newSelected = prev.selected

                    if (suggestions.length === 0) {
                        newSelected = -1
                    } else if (autoSelectFirst && prev.suggestions.length === 0) {
                        newSelected = 0
                    } else if (prev.selected >= suggestions.length) {
                        newSelected = suggestions.length - 1
                    } else if (prev.selected < 0 && suggestions.length > 0 && autoSelectFirst) {
                        newSelected = 0
                    }

                    return { suggestions, selected: newSelected }
                } else {
                    if (prev.selected >= 0 && prev.selected < prev.suggestions.length) {
                        const previousKey = prev.suggestions[prev.selected].key
                        const newIndex = suggestions.findIndex(s => s.key === previousKey)
                        if (newIndex !== -1) {
                            return { suggestions, selected: newIndex }
                        }
                    }

                    const clampedSelection = Math.min(prev.selected, suggestions.length - 1)
                    return {
                        suggestions,
                        selected: clampedSelection < 0 && suggestions.length > 0 && autoSelectFirst ? 0 : clampedSelection
                    }
                }
            })
        })

        syncRef.current = sync

        return () => {
            sync.stop()
            if (syncRef.current === sync) {
                syncRef.current = null
            }
        }
    }, [clampSelection, autoSelectFirst, allowEmptyQuery])

    useEffect(() => {
        syncRef.current?.setValue(query)
    }, [query, handler, clampSelection, autoSelectFirst, allowEmptyQuery])

    if (query === null || (!allowEmptyQuery && query === '')) {
        return [[], -1, moveUp, moveDown, clear] as const
    }

    return [state.suggestions, state.selected, moveUp, moveDown, clear] as const
}
