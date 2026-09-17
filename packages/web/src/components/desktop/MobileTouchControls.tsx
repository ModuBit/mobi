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
 * 移动端触摸控制条（迭代 2，openclaw touch-toolbar 参照）。
 *
 * 仅在触屏（pointer: coarse）+ 控制权挂起时渲染：
 * - 哨兵 textarea（视觉隐藏）：点键盘按钮聚焦唤起软键盘，input 事件经
 *   值 diff 翻译为远端删除/插入；
 * - 点按修饰键（⇧⌃⌥⌘）：挂起、被下一个普通键动作消费；
 * - 工具栏常用键：esc / tab / ⏎ / 方向 / ⌫。
 * 桌面浏览器（pointer: fine）不渲染——原生键鼠走 noVNC 自身路径。
 */

import { useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { desktopStreamProvider } from '@/core/desktop/desktopStreamProvider'
import {
    SENTINEL_VALUE,
    TOOLBAR_KEYS,
    TOUCH_MODIFIERS,
    TouchModifierState,
    diffSentinelValue,
} from '@/domain/desktop/touchInput'

export function MobileTouchControls({ machineId }: { machineId: string }) {
    const { t } = useTranslation()
    const inputRef = useRef<HTMLTextAreaElement | null>(null)
    // 哨兵值放 ref 而非 state：软键盘高频输入不触发 React 重渲（值由 DOM 自持）
    const sentinelRef = useRef(SENTINEL_VALUE)
    const modsRef = useRef(new TouchModifierState())
    // 修饰键挂起状态用于按钮高亮；仅布尔翻转时才重渲
    const [activeMods, setActiveMods] = useState<string[]>([])

    const syncActiveMods = () => {
        setActiveMods(TOUCH_MODIFIERS.filter((m) => modsRef.current.isActive(m.code)).map((m) => m.code))
    }

    const toggleModifier = (code: (typeof TOUCH_MODIFIERS)[number]['code']) => {
        modsRef.current.toggle(code)
        syncActiveMods()
    }

    const focusKeyboard = () => {
        const input = inputRef.current
        if (!input) return
        input.focus({ preventScroll: true })
        input.setSelectionRange(input.value.length, input.value.length)
    }

    const handleInput = () => {
        const input = inputRef.current
        if (!input) return
        const { backspaces, inserted } = diffSentinelValue(sentinelRef.current, input.value)
        const mods = modsRef.current.consume()
        syncActiveMods()
        desktopStreamProvider.sendBackspaces(machineId, backspaces, mods)
        desktopStreamProvider.sendText(machineId, inserted, mods)
        // 哨兵漂移出可报告删除的范围（清空/超长）即重灌
        if (input.value.length < 1 || input.value.length > SENTINEL_VALUE.length * 2) {
            input.value = SENTINEL_VALUE
        }
        sentinelRef.current = input.value
    }

    return (
        <div
            style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '4px 8px',
                background: 'var(--mobi-color-bg-layout, #141414)',
            }}
        >
            {/* 哨兵 textarea：视觉隐藏但保留可聚焦（display:none 无法唤起软键盘） */}
            <textarea
                ref={inputRef}
                defaultValue={SENTINEL_VALUE}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={t('desktop.touch.keyboard')}
                onChange={handleInput}
                style={{
                    position: 'absolute',
                    left: -9999,
                    top: 0,
                    width: 1,
                    height: 1,
                    opacity: 0,
                    resize: 'none',
                }}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" onClick={focusKeyboard} style={touchButtonStyle}>
                    {t('desktop.touch.keyboard')}
                </button>
                {TOUCH_MODIFIERS.map((mod) => (
                    <button
                        key={mod.code}
                        type="button"
                        aria-pressed={activeMods.includes(mod.code)}
                        onClick={() => toggleModifier(mod.code)}
                        style={{
                            ...touchButtonStyle,
                            ...(activeMods.includes(mod.code) ? activeModStyle : {}),
                        }}
                    >
                        {mod.label}
                    </button>
                ))}
                {TOOLBAR_KEYS.map((key) => (
                    <button
                        key={key.code}
                        type="button"
                        onClick={() => {
                            const mods = modsRef.current.consume()
                            syncActiveMods()
                            desktopStreamProvider.tapKey(machineId, key.keysym, mods)
                        }}
                        style={touchButtonStyle}
                    >
                        {key.label}
                    </button>
                ))}
            </div>
        </div>
    )
}

const touchButtonStyle: CSSProperties = {
    minWidth: 36,
    height: 32,
    padding: '0 10px',
    borderRadius: 6,
    border: '1px solid var(--mobi-color-border, #333)',
    background: 'transparent',
    color: 'inherit',
    fontSize: 14,
    lineHeight: '30px',
    cursor: 'pointer',
}

const activeModStyle: CSSProperties = {
    background: 'var(--mobi-color-primary, #faad14)',
    color: '#000',
}
