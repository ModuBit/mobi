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
 * 权限模式 → icon 组件映射
 *
 * 语义清晰、互相区分度高：
 * - auto: Bulb（智能判断/分类器）
 * - default(Manual): QuestionCircle（每次询问）
 * - acceptEdits: Edit（文件编辑）
 * - plan: Compass（规划方向，只读探查）
 * - dontAsk: Stop（拒绝未批准）
 * - bypassPermissions(YOLO): Rocket（狂飙全放行）
 */

import type { ComponentType, CSSProperties } from 'react'
import {
    BulbOutlined,
    QuestionCircleOutlined,
    EditOutlined,
    CompassOutlined,
    StopOutlined,
    RocketOutlined,
} from '@ant-design/icons'
import type { PermissionMode } from '@mobi/shared'

type IconComponent = ComponentType<{ style?: CSSProperties; fontSize?: number | string }>

const PERMISSION_MODE_ICONS: Record<PermissionMode, IconComponent> = {
    auto: BulbOutlined,
    default: QuestionCircleOutlined,
    acceptEdits: EditOutlined,
    plan: CompassOutlined,
    dontAsk: StopOutlined,
    bypassPermissions: RocketOutlined,
}

/** 获取权限模式对应的 icon 组件 */
export function getPermissionModeIcon(mode: PermissionMode): IconComponent {
    return PERMISSION_MODE_ICONS[mode]
}
