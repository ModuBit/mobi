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
 * 端别自适应的对话面板：PC = uiarc Dialog（居中模态），移动端 = BottomSheet。
 *
 * 为什么统一壳：antd Modal 在移动 PWA 上既不符合全站 sheet 语义（下拉关闭 / 手势返回 /
 * 安全区），也缺触屏手感；而 uiarc dialog 是桌面形态（居中 440px + 背景模糊）。
 * 两档共用同一份 children/footer，调用方不再各自写 `isMobile ? Drawer : Modal` 分支。
 *
 * 关闭语义：PC 走 Radix（遮罩/Escape/关闭钮 → onOpenChange(false)），移动端走 BottomSheet
 * 既有「先通知后动画、可否决」约束——父组件不翻转 open 即否决关闭。
 */
import type { CSSProperties, ReactNode } from 'react'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { Dialog, DialogContent } from '@/ui/shadcn/dialog/dialog'
import { BottomSheet } from '@/ui/base/interactive/bottom-sheet/BottomSheet'
import styles from './adaptiveDialog.module.css'

export interface AdaptiveDialogProps {
    open: boolean
    /** 请求改变开合（关闭时可能被否决：保持 open=true 即不关） */
    onOpenChange: (open: boolean) => void
    /** 标题（两档同源；移动端走 sheet 头部居中栏） */
    title: string
    /** 辅助说明行（可选） */
    description?: string
    body?: ReactNode
    /** 底部操作区（并列按钮；PC 右对齐，移动端等宽撑满） */
    footer?: ReactNode
    /** PC 面板宽度（像素或任意 CSS 长度），默认沿用 uiarc 440px；移动端忽略 */
    width?: number | string
    /** 移动端内容区附加样式（内衬默认已由本壳处理） */
    bodyStyle?: CSSProperties
    /** 移动端是否给右上关闭钮（默认 false：靠下拉/遮罩/手势返回关闭） */
    mobileShowClose?: boolean
    className?: string
}

export function AdaptiveDialog({
    open,
    onOpenChange,
    title,
    description,
    body,
    footer,
    width,
    bodyStyle,
    mobileShowClose = false,
    className,
}: AdaptiveDialogProps) {
    const isMobile = useIsMobile()

    if (isMobile) {
        return (
            <BottomSheet
                open={open}
                onClose={() => onOpenChange(false)}
                title={title}
                peek={false}
                showClose={mobileShowClose}
            >
                <div className={styles.mobileBody} style={bodyStyle}>
                    {description ? <p className={styles.mobileDescription}>{description}</p> : null}
                    {body}
                    {footer ? <div className={styles.footer}>{footer}</div> : null}
                </div>
            </BottomSheet>
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                title={title}
                description={description}
                className={className}
                // 宽度按调用方给的面板宽走，但不得超出视口（窄窗下内联宽度会盖掉
                // uiarc css 自带的 min(100vw - 32px, 440px) 上限）
                style={width === undefined
                    ? undefined
                    : { width, maxWidth: 'calc(100vw - var(--space-8))' }}
            >
                {body}
                {footer ? <div className={styles.footer}>{footer}</div> : null}
            </DialogContent>
        </Dialog>
    )
}
