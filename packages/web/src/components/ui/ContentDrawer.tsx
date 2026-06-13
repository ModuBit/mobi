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
 * 通用内容抽屉组件
 * 响应式 placement：移动端底部（MobileDrawer）、桌面端右侧
 */

import { memo, type CSSProperties, type ReactNode } from 'react'
import { Drawer } from 'antd'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { MobileDrawer } from './MobileDrawer'

/** Drawer 宽度配置 */
export type DrawerWidthConfig = number | string

/** 预设宽度配置 */
export const DRAWER_WIDTH_PRESETS = {
    /** 窄宽度：适用于普通工具 */
    narrow: 480 as DrawerWidthConfig,
    /** 宽宽度：适用于代码类工具（Edit/Write/Bash/Read 等） */
    wide: 720 as DrawerWidthConfig,
}

interface ContentDrawerProps {
    /** 标题 */
    title?: ReactNode
    /** 是否打开 */
    open: boolean
    /** 关闭回调 */
    onClose: () => void
    /** body 区域额外样式 */
    bodyStyle?: CSSProperties
    /** 内容 */
    children: ReactNode
    /** 宽度（仅 PC 端生效） */
    size?: DrawerWidthConfig
    /** 关闭时是否销毁子元素 */
    destroyOnClose?: boolean
}

function ContentDrawerInner({ title, open, onClose, bodyStyle, children, size, destroyOnClose }: ContentDrawerProps) {
    const isMobile = useIsMobile()

    if (isMobile) {
        return (
            <MobileDrawer
                open={open}
                onClose={onClose}
                title={title}
                destroyOnClose={destroyOnClose}
                styles={{
                    body: {
                        padding: 0,
                        ...bodyStyle,
                        paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
                    },
                }}
            >
                {children}
            </MobileDrawer>
        )
    }

    return (
        <Drawer
            open={open}
            onClose={onClose}
            title={title}
            placement="right"
            size={size ?? DRAWER_WIDTH_PRESETS.narrow}
            destroyOnClose={destroyOnClose}
            styles={{
                body: {
                    padding: 0,
                    ...bodyStyle,
                },
            }}
        >
            {children}
        </Drawer>
    )
}

export const ContentDrawer = memo(ContentDrawerInner)
