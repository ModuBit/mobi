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
 * 侧边栏「远程桌面」分区：hub 活跃观看流的跨设备视图。
 *
 * 数据来自 hub（GET /api/desktop/streams 轮询），手机/电脑看到同一份——
 * 在这里可以远程关掉别的设备开着的流（显式权限操作，modal.confirm 确认）。
 * 无活跃流时整体隐藏（按侧边栏既有惯例）；点击流进入 /desktop?machine= 独立页。
 */

import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { theme as antTheme, App as AntApp } from 'antd'
import styled from '@emotion/styled'
import { Monitor, X } from 'lucide-react'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'

const REFRESH_INTERVAL_MS = 5_000

export function SidebarDesktopStreams() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const api = useMobiApi()
    const { token } = antTheme.useToken()
    const { modal } = AntApp.useApp()
    const queryClient = useQueryClient()

    const { data } = useQuery({
        queryKey: queryKeys.desktopStreams,
        queryFn: () => api.desktop.streams(),
        refetchInterval: REFRESH_INTERVAL_MS,
    })
    const streams = data?.data.streams ?? []

    if (streams.length === 0) {
        return null
    }

    const closeStream = (sessionId: string) => {
        void api.desktop.closeStream(sessionId).then(() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.desktopStreams })
        })
    }

    const confirmClose = (sessionId: string, machineId: string) => {
        modal.confirm({
            title: t('nav.desktopStreamsCloseConfirm'),
            content: t('nav.desktopStreamsCloseHint', { machineId }),
            okButtonProps: { danger: true },
            onOk: () => closeStream(sessionId),
        })
    }

    return (
        <Wrap>
            <SectionLabel $token={token}>{t('nav.desktopStreams')}</SectionLabel>
            {streams.map((stream) => (
                <Row
                    key={stream.sessionId}
                    $token={token}
                    onClick={() => navigate({ to: '/desktop', search: { machine: stream.machineId } })}
                >
                    <Monitor size={16} />
                    <span className="machine-id">{stream.machineId}</span>
                    <CloseButton
                        $token={token}
                        role="button"
                        aria-label={t('nav.desktopStreamsClose')}
                        onClick={(event) => {
                            event.stopPropagation()
                            confirmClose(stream.sessionId, stream.machineId)
                        }}
                    >
                        <X size={14} />
                    </CloseButton>
                </Row>
            ))}
        </Wrap>
    )
}

const Wrap = styled.div`
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px 4px;
`

const SectionLabel = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: ${({ $token }) => $token.colorTextTertiary};
    padding: 4px 8px;
`

const Row = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: ${({ $token }) => $token.colorTextSecondary};
    cursor: pointer;

    &:hover {
        background: ${({ $token }) => $token.colorPrimaryBg};
        color: ${({ $token }) => $token.colorPrimary};

        .machine-id {
            color: inherit;
        }
    }

    .machine-id {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: ${({ $token }) => $token.colorTextSecondary};
    }
`

const CloseButton = styled.span<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    color: ${({ $token }) => $token.colorTextTertiary};

    &:hover {
        background: ${({ $token }) => $token.colorErrorBg};
        color: ${({ $token }) => $token.colorError};
    }
`
