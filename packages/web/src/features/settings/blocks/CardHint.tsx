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
import styled from '@emotion/styled'
import { theme as antTheme } from 'antd'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const CardHintBase = styled.div<{ $token: Token; $pad: string }>`
    padding: ${p => p.$pad};
    font-size: 12px;
    line-height: 1.5;
    color: ${p => p.$token.colorTextTertiary};
`

/**
 * 组卡内灰字说明行（设置分区行式形态的统一提示语言：12px/1.5 行高/三阶文字色）。
 * padding 由调用方按行位传入（首行 `10px 16px 2px`、尾行 `2px 16px 12px` 等）。
 */
export function CardHint({ pad, children }: { pad: string; children: ReactNode }) {
    const { token } = useToken()
    // data-hint：SettingGroupCard 据此让 hint 行退出行分隔线（提示是卡的注脚，不是一行设置项）
    return <CardHintBase $token={token} $pad={pad} data-hint="">{children}</CardHintBase>
}
