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

import type { ReactNode } from 'react'
import { theme as antTheme } from 'antd'
import styled from '@emotion/styled'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Card = styled.div<{ $token: Token }>`
    background: ${p => p.$token.colorBgContainer};
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    border-radius: ${p => p.$token.borderRadiusLG}px;
    overflow: hidden;

    /* 无缝分组卡：行间细分隔线，首行无线（ChatGPT 分组卡形态） */
    & > * + * {
        border-top: 1px solid ${p => p.$token.colorBorderSecondary};
    }
`

const GroupTitle = styled.div<{ $token: Token }>`
    padding: 0 4px 6px;
    font-size: 12.5px;
    font-weight: 500;
    color: ${p => p.$token.colorTextSecondary};
`

export interface SettingGroupCardProps {
    /** 组标签（卡外灰字小节标题，ChatGPT「常规 / 昵称」式）；缺省不渲染标签节点 */
    title?: ReactNode
    /** 设置行（SettingRow）列表；行间分隔线由容器收口 */
    children: ReactNode
}

/**
 * 分组无缝卡容器：一个圆角卡内多行 + 行间细分隔线，可选组标签渲染在卡外。
 * SettingRow 的容器；分隔线由容器统一负责，行自身不画线。
 */
export function SettingGroupCard({ title, children }: SettingGroupCardProps) {
    const { token } = useToken()
    return (
        <div>
            {title !== undefined && <GroupTitle $token={token}>{title}</GroupTitle>}
            <Card $token={token}>{children}</Card>
        </div>
    )
}
