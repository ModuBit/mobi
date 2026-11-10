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
import type { InputHTMLAttributes } from 'react'
import { Switch, theme as antTheme } from 'antd'
import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import styled from '@emotion/styled'
import { Input } from '@/ui/base/interactive/input/Input'
import { PasswordField } from '@/ui/base/interactive/password-field/PasswordField'
import { Select } from '@/ui/base/interactive/select/Select'
import type { SelectProps } from '@/ui/base/interactive/select/Select'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

/** 设置行形态：只读值 / 行内下拉 / 开关 / 行内输入 / 导航 / 操作 */
export type SettingRowVariant = 'value' | 'inline-select' | 'switch' | 'input' | 'navigate' | 'action'

interface SettingRowBase {
    /** 行标签（左侧） */
    label: ReactNode
    /** 行下灰字说明（ChatGPT「参考照片」式，可选） */
    description?: ReactNode
    /** 行首图标（可选） */
    icon?: LucideIcon
}

export type SettingRowProps = SettingRowBase &
    (
        | { variant?: 'value'; /** 右侧只读值 */ value?: ReactNode }
        | { variant: 'inline-select'; /** 自管 Select 全量 props（受控由调用方持有） */ select: SelectProps<string> }
        | {
              variant: 'switch'
              checked: boolean
              onCheckedChange: (checked: boolean) => void
              disabled?: boolean
              /** 开关的可访问名（缺省用 label） */
              ariaLabel?: string
          }
        | {
              variant: 'input'
              /** uiarc Input props（受控由调用方持有）；label 用作可访问名 */
              input: InputHTMLAttributes<HTMLInputElement>
              /** 密码态（PasswordField 渲染，如 API Token / key 类字段） */
              secret?: boolean
          }
        | {
              variant: 'navigate'
              onClick: () => void
              disabled?: boolean
              /** 右侧当前值（值 + chevron 并存，ChatGPT 行形态，可选） */
              value?: ReactNode
          }
        | { variant: 'action'; /** 右侧操作区（自管 Button 等） */ action: ReactNode }
    )

const rowBase = (p: { $token: Token }) => `
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 16px;
    min-height: 48px;
    text-align: left;
    background: transparent;
    font-size: inherit;
    color: inherit;
    border: none;
    width: 100%;

    &:focus-visible {
        outline: 2px solid ${p.$token.colorPrimary};
        outline-offset: -2px;
    }
`

const Row = styled.div<{ $token: Token }>`
    ${rowBase}
`

/** 导航行：唯一整行可点形态，button 语义 + hover 反馈 */
const NavRow = styled.button<{ $token: Token; $disabled: boolean }>`
    ${rowBase}
    cursor: ${p => (p.$disabled ? 'not-allowed' : 'pointer')};
    opacity: ${p => (p.$disabled ? 0.5 : 1)};

    &:hover {
        background: ${p => (p.$disabled ? 'transparent' : p.$token.colorFillQuaternary)};
    }
`

const IconBox = styled.span<{ $token: Token }>`
    display: flex;
    flex-shrink: 0;
    /* 弱化用色 token 而非 opacity：随主题/状态联动（与 GuideSection IconBox 同语言） */
    color: ${p => p.$token.colorTextSecondary};
`

const TextCol = styled.span`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
`

const Label = styled.span<{ $token: Token }>`
    font-size: 14px;
    color: ${p => p.$token.colorText};
`

const Description = styled.span<{ $token: Token }>`
    font-size: 12px;
    line-height: 1.5;
    color: ${p => p.$token.colorTextTertiary};
`

const ValueText = styled.span<{ $token: Token }>`
    flex-shrink: 0;
    font-size: 13.5px;
    color: ${p => p.$token.colorTextSecondary};
`

const Chevron = styled.span<{ $token: Token }>`
    flex-shrink: 0;
    display: flex;
    color: ${p => p.$token.colorTextQuaternary};
`

const SelectSlot = styled.div`
    flex-shrink: 0;
`

const InputSlot = styled.div`
    flex: 1;
    display: flex;
    min-width: 0;
`

const ActionSlot = styled.div`
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
`

/**
 * 设置行原语（ChatGPT 子页行式形态）：label 左、当前值/控件右、可选行下说明。
 * 五种交互 variant + 只读 value 行；与 SettingGroupCard 配合使用（分隔线归容器）。
 *
 * inline-select 的交互点是行右侧的下拉控件（自管 Select 触发器），
 * 不做整行触发——避免改 Select 触发器结构；navigate 才是整行可点。
 * 组件不引入 i18n：所有文案由调用方解析后传入（ui 层不向上引）。
 */
export function SettingRow(props: SettingRowProps) {
    const { token } = useToken()
    const { label, description, icon: Icon } = props

    const text = (
        <TextCol>
            <Label $token={token}>{label}</Label>
            {description !== undefined && <Description $token={token}>{description}</Description>}
        </TextCol>
    )

    const accessibleName = typeof label === 'string' ? label : undefined

    let nav: { onClick: () => void; disabled?: boolean } | null = null
    let right: ReactNode

    switch (props.variant) {
        case 'inline-select':
            right = (
                <SelectSlot>
                    <Select<string> {...props.select} />
                </SelectSlot>
            )
            break
        case 'switch':
            right = (
                <Switch
                    checked={props.checked}
                    onChange={props.onCheckedChange}
                    disabled={props.disabled}
                    aria-label={props.ariaLabel ?? accessibleName}
                />
            )
            break
        case 'input':
            right = (
                <InputSlot>
                    {/* uiarc 自管 Input / PasswordField（行内不传 label，可访问名走行标签）：
                        surface 底 + border-strong 边框，focus 边框变 --foreground——
                        与自管 Select/Combobox 同一套控件语言 */}
                    {props.secret ? (
                        <PasswordField {...props.input} aria-label={accessibleName} />
                    ) : (
                        <Input {...props.input} aria-label={accessibleName} />
                    )}
                </InputSlot>
            )
            break
        case 'navigate':
            nav = { onClick: props.onClick, disabled: props.disabled }
            right = (
                <>
                    {props.value !== undefined && <ValueText $token={token}>{props.value}</ValueText>}
                    <Chevron $token={token}>
                        <ChevronRight size={16} />
                    </Chevron>
                </>
            )
            break
        case 'action':
            right = <ActionSlot>{props.action}</ActionSlot>
            break
        default:
            right = props.value !== undefined ? <ValueText $token={token}>{props.value}</ValueText> : null
    }

    const rowContent = (
        <>
            {Icon !== undefined && (
                <IconBox $token={token}>
                    {/* 1.5px 描边配 14px/400 标签的光重（2px 是 semibold 旁的档位） */}
                    <Icon size={18} strokeWidth={1.5} />
                </IconBox>
            )}
            {text}
            {right}
        </>
    )

    if (nav) {
        return (
            <NavRow
                type="button"
                $token={token}
                $disabled={Boolean(nav.disabled)}
                disabled={nav.disabled}
                onClick={nav.onClick}
            >
                {rowContent}
            </NavRow>
        )
    }

    return <Row $token={token}>{rowContent}</Row>
}
