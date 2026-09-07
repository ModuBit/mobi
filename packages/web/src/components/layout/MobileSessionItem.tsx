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

import { theme as antTheme } from 'antd'
import { MoreOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { getSessionAvatarStatus } from '@/core/utils/sessionStatus'
import { resolveForkSessionState } from './forkSessionLabel'
import { ForkRowTitle } from './ForkRowTitle'
import { ForkStateBadge } from './ForkStateBadge'
import { StatusStateIcon } from '@/components/tool-card/toolIcons'
import { useLongPress } from '@/core/data/hooks/useLongPress'
import type { Session } from '@/core/data/api/types'
import { SessionItem, SessionName, TimeLabel, MoreButton } from './mobileProjectList.styles'

const { useToken } = antTheme

interface MobileSessionItemProps {
    session: Session
    active: boolean
    onClick: () => void
    /** 长按或点击 ⋮ 触发的操作回调 */
    onLongPress: () => void
}

/**
 * 移动端单个会话项
 * 支持点击导航、长按弹出操作菜单（与点击 ⋮ 等效）
 */
export function MobileSessionItem({ session, active, onClick, onLongPress }: MobileSessionItemProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const longPress = useLongPress(onLongPress)

    const avatarStatus = getSessionAvatarStatus(session)
    const displayName = getSessionDisplayName(session)
    const relativeTime = formatRelativeTime(session.updatedAt, t)
    // fork 行：自动命名「〈parent 标题〉 · 分叉」+ 待激活/激活失败徽标（spec §4.3）
    const forkState = resolveForkSessionState(session, t)

    return (
        <SessionItem
            $active={active}
            $token={token}
            onClick={longPress.withClickGuard(onClick)}
            onTouchStart={longPress.onTouchStart}
            onTouchEnd={longPress.onTouchEnd}
            onTouchMove={longPress.onTouchMove}
        >
            <StatusStateIcon state={avatarStatus} style={{ width: 10, height: 10 }} />
            {forkState.isForkRow ? <ForkRowTitle session={session}>{(title) => <SessionName $token={token}>{title}</SessionName>}</ForkRowTitle> : <SessionName $token={token}>{displayName}</SessionName>}
            {(forkState.isPendingActivation || forkState.isActivationFailed) && (
                <ForkStateBadge
                    variant={forkState.isActivationFailed ? 'error' : 'pending'}
                    errorText={forkState.errorText}
                />
            )}
            <TimeLabel $token={token}>{relativeTime}</TimeLabel>
            <MoreButton
                $token={token}
                onClick={(e) => { e.stopPropagation(); onLongPress() }}
                aria-label={t('common.more')}
            >
                <MoreOutlined style={{ fontSize: 16 }} />
            </MoreButton>
        </SessionItem>
    )
}
