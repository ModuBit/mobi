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
 * 响应式 placement：移动端底部、桌面端右侧
 */

import { memo, type CSSProperties, type ReactNode } from 'react'
import { Drawer } from 'antd'
import { useIsMobile } from '@/hooks/useMediaQuery'

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
}

function ContentDrawerInner({ title, open, onClose, bodyStyle, children }: ContentDrawerProps) {
    const isMobile = useIsMobile()

    return (
        <Drawer
            open={open}
            onClose={onClose}
            title={title}
            placement={isMobile ? 'bottom' : 'right'}
            width={isMobile ? undefined : 400}
            styles={{
                wrapper: isMobile ? { height: 'auto', maxHeight: '85vh' } : undefined,
                body: {
                    padding: 0,
                    ...bodyStyle,
                    ...(isMobile ? { paddingBottom: 'max(24px, env(safe-area-inset-bottom))' } : {}),
                },
            }}
        >
            {children}
        </Drawer>
    )
}

export const ContentDrawer = memo(ContentDrawerInner)
