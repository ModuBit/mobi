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

import { LoadingOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { theme as antTheme } from 'antd'
import type { SessionListVariant } from './SessionSkeletonRows'

/** antd 主题 token 类型（与各组件 useToken 返回一致） */
type Token = ReturnType<typeof antTheme.useToken>['token']

// 列表底部链接区（收起 / 展开更多 并列）
const ListFooter = styled.div<{ $variant: SessionListVariant }>`
    display: flex;
    align-items: center;
    ${props => props.$variant === 'mobile'
        ? 'gap: 20px;\n    min-height: 36px;\n    padding: 0 12px 0 50px;'
        : 'gap: 16px;\n    padding: 4px 8px 4px 30px;'}
`

// 底部链接（收起、展开更多共用）
const FooterLink = styled.button<{ $token: Token; $variant: SessionListVariant }>`
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextTertiary};
    font-size: ${props => props.$variant === 'mobile' ? '13px' : '12px'};
    padding: 0;
    cursor: pointer;

    ${props => props.$variant === 'mobile'
        ? `&:active {
        color: ${props.$token.colorPrimary};
    }`
        : `transition: color 0.15s;

    &:hover {
        color: ${props.$token.colorPrimary};
    }`}

    &:disabled {
        cursor: default;
        opacity: 0.7;
    }
`

/** 会话列表展示态推导输入（桌面与移动分组一致） */
interface SessionListDisplayInput {
    /** 首次加载中（尚无任何数据） */
    isLoadingInitial: boolean
    /** 会话总数（含未展开） */
    sessionCount: number
    /** 已展开且超出首屏，可收起 */
    showCollapse: boolean
    /** 还有未展示的会话，可展开更多 */
    canShowMore: boolean
    /** 正在加载下一页 */
    isLoadingMore: boolean
}

/** 会话列表展示态：骨架优先于空态；底部链接仅在非骨架且有可交互项时出现 */
export function getSessionListDisplayState({
    isLoadingInitial, sessionCount, showCollapse, canShowMore, isLoadingMore,
}: SessionListDisplayInput) {
    const showSkeleton = isLoadingInitial && sessionCount === 0
    const showEmpty = !showSkeleton && sessionCount === 0
    const showFooter = !showSkeleton && (showCollapse || canShowMore || isLoadingMore)
    return { showSkeleton, showEmpty, showFooter }
}

interface SessionListFooterProps {
    variant: SessionListVariant
    canShowMore: boolean
    /** 未展示的剩余会话数（>0 时展示「还有 N 条」文案） */
    remainingCount: number
    isLoadingMore: boolean
    showCollapse: boolean
    onShowMore: () => void
    onCollapse: () => void
}

/** 会话列表底部链接（展开更多 / 收起 / 加载中，桌面侧边栏与移动端菜单共用） */
export function SessionListFooter({
    variant, canShowMore, remainingCount, isLoadingMore, showCollapse, onShowMore, onCollapse,
}: SessionListFooterProps) {
    const { token } = antTheme.useToken()
    const { t } = useTranslation()

    return (
        <ListFooter $variant={variant}>
            {canShowMore && !isLoadingMore && (
                <FooterLink $token={token} $variant={variant} onClick={onShowMore}>
                    {remainingCount > 0
                        ? t('nav.showMore', { count: remainingCount })
                        : t('nav.loadMore')}
                </FooterLink>
            )}
            {showCollapse && !isLoadingMore && (
                <FooterLink $token={token} $variant={variant} onClick={onCollapse}>
                    {t('nav.collapse')}
                </FooterLink>
            )}
            {isLoadingMore && (
                <FooterLink $token={token} $variant={variant} disabled>
                    <LoadingOutlined /> {t('common.loading')}
                </FooterLink>
            )}
        </ListFooter>
    )
}
