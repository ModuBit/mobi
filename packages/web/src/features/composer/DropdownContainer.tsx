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

import type React from 'react'
import styles from './dropdownContainer.module.css'

interface DropdownContainerProps {
    children: React.ReactNode
}

/**
 * composer 建议面板外壳（uiarc 视觉语言）：
 * 贴 Sender 上方、占满输入区宽度；承载底色 / 描边 / 圆角 / 投影 / 进场。
 * 列表本体（滑动高亮、滚动、ARIA）归 ui/base 的 SuggestionList，本组件不含业务语义。
 */
export function DropdownContainer({ children }: DropdownContainerProps) {
    return (
        <div className={styles.panel} data-mobi-suggestion-panel="">
            {children}
        </div>
    )
}
