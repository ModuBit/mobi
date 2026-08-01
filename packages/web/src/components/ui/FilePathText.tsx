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

import { memo, type CSSProperties } from 'react'
import { Tooltip } from 'antd'

/**
 * 文件路径左省略组件
 * 空间不足时目录部分省略，保留文件名完整；hover 显示完整路径。
 *
 * 用 CSS flex（dirPart 右省略 + fileName 固定）+ Tooltip 替代 antd Typography.ellipsis。
 * 原因：antd Typography.ellipsis 在 mount 时同步读几何属性（isEleEllipsis）判断是否省略，
 * 虚拟化（react-virtuoso）下 bubble 频繁 mount/unmount 会放大该检测 → forced reflow
 * （PoC trace 实测 228ms）。CSS 省略纯样式、mount 不读几何；Tooltip 只在 hover 时定位。
 */
function FilePathTextInner({ path, strong, style }: { path: string; strong?: boolean; style?: CSSProperties }) {
    const lastSlash = path.lastIndexOf('/')
    const weight = strong ? 600 : undefined
    const content = lastSlash < 0 ? (
        <span
            style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                fontWeight: weight,
                ...style,
            }}
        >
            {path}
        </span>
    ) : (
        <span style={{ display: 'flex', minWidth: 0, ...style }}>
            <span
                style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                    fontWeight: weight,
                }}
            >
                {path.slice(0, lastSlash)}
            </span>
            <span style={{ flexShrink: 0, fontWeight: weight }}>/{path.slice(lastSlash + 1)}</span>
        </span>
    )

    return (
        <Tooltip title={path}>
            <span style={{ display: 'inline-flex', minWidth: 0, flex: '1 1 0', cursor: 'default' }}>
                {content}
            </span>
        </Tooltip>
    )
}

export const FilePathText = memo(FilePathTextInner)
