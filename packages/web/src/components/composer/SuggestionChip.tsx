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

import { Tag } from 'antd'
import { BulbOutlined, CloseOutlined } from '@ant-design/icons'
import type { CSSProperties } from 'react'

// Tag 本体样式：紧凑、单行省略；margin:0 抹掉默认外边距，由外层 div 统一控制留白
const TAG_STYLE: CSSProperties = {
    margin: 0,
    padding: '2px 8px',
    cursor: 'pointer',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
}

interface SuggestionChipProps {
    text: string
    /** 视觉隐藏（用户输入时）：保持挂载，靠 CSS 过渡丝滑收起，store 不清 */
    hidden?: boolean
    onAccept: () => void
    onDismiss: () => void
}

/**
 * 下一轮建议 chip, 显示在 Sender header 中, 用 antd Tag 呈现。
 * 点击 chip → 回填草稿(onAccept); 点击 ✕ → 关闭(onDismiss)。
 * 外层 padding 让 chip 不紧贴 Sender 的上/左边界。
 * hidden=true 时丝滑收起（opacity + 上移 + max-height 塌缩），清空 draft 即恢复。
 * 纯受控组件, 生命周期由父级(ChatComposer)通过 store 管理。
 */
export function SuggestionChip({ text, hidden, onAccept, onDismiss }: SuggestionChipProps) {
    return (
        <div
            style={{
                padding: '4px 8px 0 4px',
                opacity: hidden ? 0 : 1,
                transform: hidden ? 'translateY(-4px)' : 'translateY(0)',
                maxHeight: hidden ? 0 : 60,
                overflow: 'hidden',
                transition: 'opacity .2s ease, transform .2s ease, max-height .2s ease',
            }}
        >
            <Tag
                icon={<BulbOutlined />}
                closable
                closeIcon={<CloseOutlined style={{ fontSize: 10 }} />}
                onClick={() => onAccept()}
                onClose={(e) => {
                    // 阻止冒泡到 Tag 的 onClick：关闭不应同时触发采纳
                    e.preventDefault()
                    e.stopPropagation()
                    onDismiss()
                }}
                style={TAG_STYLE}
            >
                {text}
            </Tag>
        </div>
    )
}
