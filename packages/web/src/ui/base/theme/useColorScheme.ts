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
 * ref 所在主题档位嗅探："dark" 当 documentElement 的 data-theme 翻转（mobi 全站
 * 主题单源）且计算样式 color-scheme 为 dark，否则 "light"。切档通过
 * MutationObserver 响应——消费方（openui 的 Map/HtmlView 等脱离 antd 主题上下文
 * 的自定义组件）拿不到 ConfigProvider 的响应式值，只能观测 DOM。
 */

import { useEffect, useState, type RefObject } from 'react'

export function useColorScheme(ref: RefObject<HTMLElement | null>): 'light' | 'dark' {
    const [scheme, setScheme] = useState<'light' | 'dark'>('light')
    useEffect(() => {
        const read = () => {
            const value = ref.current ? getComputedStyle(ref.current).colorScheme : ''
            setScheme(value.trim() === 'dark' ? 'dark' : 'light')
        }
        read()
        const observer = new MutationObserver(read)
        observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-theme'] })
        return () => observer.disconnect()
    }, [ref])
    return scheme
}
