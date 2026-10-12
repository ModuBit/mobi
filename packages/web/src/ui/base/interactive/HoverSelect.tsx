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

import { Select, theme } from 'antd'
import styled from '@emotion/styled'
import { shouldNotForwardDollarProps } from '@/core/lib/styledUtils'

/**
 * 会话入口共用的紧凑下拉（ChatComposer / NewSessionPage）。
 * 单一定义点：antd6 覆盖补丁、圆角/过渡等观感调整只改这里，不随调用方复制漂移。
 */
export const HoverSelect = styled(Select, {
    shouldForwardProp: shouldNotForwardDollarProps,
})<{
    $token: ReturnType<typeof theme.useToken>['token']
    $compact?: boolean
}>`
    border-radius: ${props => props.$token.borderRadiusSM}px;
    transition: background 0.2s;

    /* 覆盖 antd6 默认：下拉展开时有值内容被压暗到 opacity 0.25。
       紧凑选择器（权限模式图标 / 模型名）收起与展开观感应一致，保持原色 */
    &&.ant-select-open .ant-select-content-has-value {
        opacity: 1;
    }
    ${props => props.$compact && `
        height: 24px !important;
        &&& .ant-select-input {
            font-size: 12px !important;
        }
    `}
`

export type HoverSelectProps = React.ComponentProps<typeof HoverSelect>
