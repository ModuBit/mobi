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
 * 管理页行组合件（架构深化候选⑥）：「名字 + 徽标组 + 描述 + 右槽」的槽位结构，
 * skill / mcp / plugin 各域的行组件在其上做语义皮肤（徽标内容与动作差异）。
 * 此前 SkillRow 与 BundledSkillRow 各持一份近乎逐字的五件套 styled（~60 行重复）。
 */
import type { HTMLAttributes, ReactNode } from 'react'
import { theme as antTheme } from 'antd'
import styled from '@emotion/styled'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Row = styled.div<{ $opacity: number }>`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    min-width: 0;

    /* 不透明度语义由调用方定：生效态 off 弱化（0.55）/ 只读行轻弱化（0.75）/ 常规（1） */
    opacity: ${p => p.$opacity};
`

const Main = styled.div`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
`

const NameRow = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
`

const Name = styled.span<{ $token: Token }>`
    font-size: 13px;
    font-weight: 500;
    color: ${p => p.$token.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
`

const Desc = styled.div<{ $token: Token }>`
    font-size: 12px;
    color: ${p => p.$token.colorTextTertiary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

/** 低饱和徽标（来源 / 渠道 / 调用性），与状态徽标（语义色）区分；token 自取自 antd context */
const Tag = styled.span<{ $token: Token }>`
    font-size: 11px;
    line-height: 1;
    padding: 3px 7px;
    border-radius: var(--radius-square);
    color: ${p => p.$token.colorTextTertiary};
    background: ${p => p.$token.colorFillQuaternary};
    white-space: nowrap;
`

export function ManageRowTag(props: HTMLAttributes<HTMLSpanElement>) {
    const { token } = useToken()
    return <Tag $token={token} {...props} />
}

const Right = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
`

export interface ManageRowProps extends HTMLAttributes<HTMLDivElement> {
    /** 调用名（展示 + 行内 data 锚点由调用方经 ...attrs 透传） */
    name: string
    /** 描述（缺省不渲染描述行） */
    description?: string
    /** 名字行徽标组（ManageRowTag 集合） */
    badges?: ReactNode
    /** 右槽（状态徽标 + 动作钮）；不传 = 纯只读行无右槽 */
    right?: ReactNode
    /** 整行不透明度（默认 1；弱化语义见 Row 注释） */
    opacity?: number
}

export function ManageRow({ name, description, badges, right, opacity = 1, ...attrs }: ManageRowProps) {
    const { token } = useToken()

    return (
        <Row $opacity={opacity} {...attrs}>
            <Main>
                <NameRow>
                    <Name $token={token}>{name}</Name>
                    {badges}
                </NameRow>
                {description && <Desc $token={token}>{description}</Desc>}
            </Main>
            {right && <Right>{right}</Right>}
        </Row>
    )
}
