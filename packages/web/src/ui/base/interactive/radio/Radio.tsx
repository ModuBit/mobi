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
 * Radio —— 单个单选控件（**自建件，无上游 registry 条目**，落 ui/base/，不登记 registry.json）。
 *
 * 由已迁移的两个 uiarc 单选件拆出：
 * - 指示器直接复用 `ui/shadcn/radio-cards` 导出的 `RadioIndicator`（同一 18px 圆 + 弹簧圆点单源，
 *   上游正是为「自带行壳的嵌入方」导出的复用点）；
 * - 交互壳取 `ui/shadcn/radio-group` 的做法：`<label>` 包住视觉隐藏的原生 `<input type="radio">`，
 *   点整行、Tab 聚焦、空格切换都由浏览器承担，自绘层只做呈现。
 *
 * 为什么单独拆一个而不是复用整组件：消费场景是「一行表单里的一个布尔选择」（如工作区文件夹行的
 * 「主目录」），既没有同组选项（radio-group 的 fieldset/legend/整组 tab stop 语义不成立），
 * 也不需要卡片壳（radio-cards 的描边卡片与滑移 ring 会把一行表单撑成一块面板）。
 *
 * 契约：
 * - 完全受控：选中态由调用方经 `checked` 持有（单行布尔场景没有内部控制态的需求）
 * - `onChange(next: boolean)`：点选 / 键盘切换后回调新值
 * - `disabled` 同时压住原生 input 与自绘指示器（指示器走 RadioIndicator 的 disabled 分支）
 */
import type { ChangeEvent, ReactNode } from 'react'
import { RadioIndicator } from '@/ui/shadcn/radio-cards/radio-cards'
import styles from './radio.module.css'

export interface RadioProps {
    /** 选中态（受控） */
    checked: boolean
    /** 选中态变化回调（参数为变化后的值） */
    onChange?: (checked: boolean) => void
    disabled?: boolean
    /** 悬停提示（与 antd Radio 同名 prop，便于内联迁移） */
    title?: string
    className?: string
    children: ReactNode
}

export function Radio({ checked, onChange, disabled = false, title, className, children }: RadioProps) {
    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        onChange?.(event.target.checked)
    }

    return (
        <label
            className={[styles.radio, className].filter(Boolean).join(' ')}
            data-checked={checked || undefined}
            data-disabled={disabled || undefined}
            title={title}
        >
            <input
                type="radio"
                className={styles.input}
                checked={checked}
                disabled={disabled}
                onChange={handleChange}
            />
            <span className={styles.mark} aria-hidden="true">
                <RadioIndicator checked={checked} disabled={disabled} />
            </span>
            <span className={styles.label}>{children}</span>
        </label>
    )
}
