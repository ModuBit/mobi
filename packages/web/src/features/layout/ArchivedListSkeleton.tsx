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

import styled from '@emotion/styled'
import { theme as antTheme } from 'antd'

import { SkeletonBar } from './SkeletonBar'

type Token = ReturnType<typeof antTheme.useToken>['token']

/** 骨架容器：占满列表区，不参与页面滚动（真实列表由 Listy 自己滚） */
const Wrap = styled.div`
    flex: 1;
    min-height: 0;
    overflow: hidden;
`

/** 组头占位：尺寸对齐 ListyShell 里的 `.archived-listy-header`（首组免顶距） */
const GroupRow = styled.div<{ $token: Token; $first: boolean }>`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: ${p => (p.$first ? '0' : '28px')} 4px 12px;
    height: ${p => (p.$first ? 32 : 60)}px;
`

const GroupIcon = styled.span<{ $token: Token }>`
    width: 16px;
    height: 16px;
    border-radius: var(--radius-control-sm);
    background: ${p => p.$token.colorFillSecondary};
    flex-shrink: 0;
`

/** 卡片占位：与真实行卡同一套描边/圆角（首末行圆角由容器裁切） */
const Card = styled.div<{ $token: Token }>`
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    border-radius: var(--radius-panel);
    background: ${p => p.$token.colorBgContainer};
    overflow: hidden;
`

/** 行占位：行高与内衬对齐真实行（ArchivedRow：12px 16px，实测 66px） */
const Row = styled.div<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: 12px;
    height: 66px;
    padding: 12px 16px;

    & + & {
        border-top: 1px solid ${p => p.$token.colorBorderSecondary};
    }
`

const RowMain = styled.div`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
`

interface ArchivedListSkeletonProps {
    /** 骨架行数（默认 6：一屏可见量） */
    rows?: number
}

/** 归档页首次加载骨架：组头 + 行卡占位，数据到达时布局不跳动 */
export function ArchivedListSkeleton({ rows = 6 }: ArchivedListSkeletonProps) {
    const { token } = antTheme.useToken()

    return (
        <Wrap aria-busy="true">
            <GroupRow $token={token} $first>
                <GroupIcon $token={token} />
                <SkeletonBar $token={token} style={{ width: 112, height: 12 }} />
                <SkeletonBar $token={token} style={{ width: 52, height: 10, marginLeft: 'auto' }} />
            </GroupRow>
            <Card $token={token}>
                {Array.from({ length: rows }, (_, idx) => (
                    <Row key={idx} $token={token} data-skeleton-row>
                        <RowMain>
                            <SkeletonBar $token={token} style={{ width: '46%', maxWidth: 260, height: 14 }} />
                            <SkeletonBar $token={token} style={{ width: '30%', maxWidth: 170, height: 10 }} />
                        </RowMain>
                        <SkeletonBar $token={token} style={{ width: 28, height: 28, borderRadius: 'var(--radius-icon)' }} />
                        <SkeletonBar $token={token} style={{ width: 81, height: 28 }} />
                    </Row>
                ))}
            </Card>
        </Wrap>
    )
}
