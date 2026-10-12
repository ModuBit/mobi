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
 * 草图编辑角标：缩略图右下角的铅笔徽记，标识「这张图能再画」（画板重编辑入口）。
 * 聊天气泡与 composer 附件卡两个消费方共用一份视觉规格——角标参数散落两份已经
 * 漂移过（底色 alpha / 圆角 / 图标源各写各的），收拢为单一来源。
 *
 * hover 显现策略由容器决定：showOnHover 时挂 sketch-edit-badge 类，配合调用方的
 * 容器 `&:hover .sketch-edit-badge { opacity: 1 }` 规则（气泡图卡片空间大、hover
 * 显现不打扰；附件小缩略图无 hover 余地则常显）。
 */

import { theme } from 'antd'
import type { MouseEvent } from 'react'
import { Pencil } from 'lucide-react'

export interface SketchEditBadgeProps {
    /** 无障碍名（同时作原生 title） */
    label: string
    /** 点击回调（如打开画板重编辑）；缺省为纯展示 */
    onClick?: (e: MouseEvent<HTMLSpanElement>) => void
    /** 随父级 hover 显现（配合父容器的 .sketch-edit-badge hover 规则）；缺省常显 */
    showOnHover?: boolean
}

export function SketchEditBadge({ label, onClick, showOnHover }: SketchEditBadgeProps) {
    const { token } = theme.useToken()
    return (
        <span
            className={showOnHover ? 'sketch-edit-badge' : undefined}
            title={label}
            aria-label={label}
            style={{
                position: 'absolute',
                right: 3,
                bottom: 3,
                display: 'inline-flex',
                padding: 3,
                borderRadius: token.borderRadiusSM,
                background: 'rgba(255, 255, 255, 0.88)',
                color: token.colorTextSecondary,
                cursor: onClick ? 'pointer' : undefined,
            }}
            onClick={onClick}
        >
            <Pencil size={12} />
        </span>
    )
}
