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

import { useState } from 'react'
import { App, Button, Input, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import styled from '@emotion/styled'
import { credentialKeysFor } from '@mobi/shared'
import type { RedactedWebToolsConfig } from '@mobi/shared'

/**
 * 验证连接结果（verify RPC envelope，success 风格）：
 * 成功带延迟毫秒数；失败带错误文案（runner/传输层错误统一收敛为 success:false 由调用侧包装）。
 */
export type VerifyResult = { success: true; latencyMs: number } | { success: false; error: string }

/** 脱敏配置中的 provider 条目（凭据只有 set 标记 + 掩码 preview，无明文） */
export type ProviderEntry = NonNullable<RedactedWebToolsConfig['providers']>[number]

export interface CredentialEditorProps {
    provider: ProviderEntry
    /**
     * 在场性提交：只提交编辑中的凭据键（非空新值）；未修改的键不进 payload = 保持旧值。
     * 失败 toast 归属上层（WebToolsSection.saveBase）——本组件收到 false 时保持编辑态静默返回，禁止重复弹错。
     */
    onSave: (credentials: Record<string, string>) => Promise<boolean>
    /** 空对象 = 用已存凭据验证（runner 侧已存值兜底）；非空 = 验证草稿新值 */
    onVerify: (credentials: Record<string, string>) => Promise<VerifyResult>
}

const { useToken } = antTheme

type Token = ReturnType<typeof useToken>['token']

// 编辑器容器：内联虚线框（与卡头实线区分层级——编辑区是二级内容）
const EditorBox = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
    padding: 12px;
    border: 1px dashed ${p => p.$token.colorBorder};
    border-radius: 12px;
    background: ${p => p.$token.colorFillQuaternary};
`

// 凭据键行：label + set 状态文案 + 输入框
const FieldRow = styled.div`
    display: flex;
    flex-direction: column;
    gap: 4px;
`

const FieldLabel = styled.label<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: ${p => p.$token.colorTextSecondary};
`

// set 状态文案：已设（绿）/未设（灰）
const SetBadge = styled.span<{ $token: Token; $set: boolean }>`
    font-size: 11px;
    color: ${p => (p.$set ? p.$token.colorSuccessText : p.$token.colorTextTertiary)};
`

const Actions = styled.div<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: ${p => p.$token.marginXS}px;
    flex-wrap: wrap;
`

// 验证结果：成功绿 / 失败红，字号与 hint 一致
const VerifyOutcome = styled.span<{ $token: Token; $ok: boolean }>`
    font-size: 11.5px;
    line-height: 1.5;
    color: ${p => (p.$ok ? p.$token.colorSuccessText : p.$token.colorErrorText)};
`

/**
 * 凭据编辑器：只读预览态（掩码 preview）↔ 替换编辑态。
 *
 * 设计动机：hub 只回脱敏 preview（如 `tvly-******56`），明文不可回传浏览器——
 * 掩码串不可被误当作真实值编辑，改凭据必须点「替换」显式表达意图（清空重填）。
 * 凭据未设置（set:false）时无预览可显，直接进入编辑态。
 *
 * 在场性提交：保存/验证 payload 只携带与初始 preview 不同的键——未编辑的凭据键
 * 不在场即"保持旧值"，避免掩码串覆盖真实凭据。
 */
export function CredentialEditor({ provider, onSave, onVerify }: CredentialEditorProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message } = App.useApp()

    const keys = credentialKeysFor(provider.id)

    // 初始预览值：已设置的键取掩码 preview，未设置的键为空
    const initialPreview = Object.fromEntries(
        keys.map((key) => [key, provider.credentials[key]?.set ? provider.credentials[key]?.preview ?? '' : '']),
    ) as Record<string, string>

    // 任一键未设置 → 无预览可显，初始即编辑态
    const initiallyEditing = keys.some((key) => !provider.credentials[key]?.set)

    const [editing, setEditing] = useState(initiallyEditing)
    const [draft, setDraft] = useState<Record<string, string>>(initialPreview)
    const [saving, setSaving] = useState(false)
    const [verifying, setVerifying] = useState(false)
    const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)

    /** 预览态点「替换」：清空该键草稿进入编辑态（掩码串不能作为编辑起点） */
    const startEditing = () => {
        setDraft(Object.fromEntries(keys.map((key) => [key, ''])))
        setVerifyResult(null)
        setEditing(true)
    }

    /** 取消：草稿恢复 preview、编辑态回到初始规则、验证结果清空 */
    const cancelEditing = () => {
        setDraft(initialPreview)
        setVerifyResult(null)
        setEditing(initiallyEditing)
    }

    /**
     * 在场性过滤：只取草稿值 ≠ 初始 preview 且非空的键（保存与验证共用）。
     * 空串必须排除：写侧 merge 对空凭据键静默保持旧值，提交空串会造成「已保存」却未改的假象。
     * 验证不同：空草稿 + 已存凭据 → 传空对象用已存值验证（runner 兜底），
     * 只有「无草稿变更且无已存凭据」才无可验证。
     */
    const changedCredentials = (): Record<string, string> =>
        Object.fromEntries(
            keys.filter((key) => draft[key] !== initialPreview[key] && draft[key] !== '').map((key) => [
                key,
                draft[key],
            ]),
        )
    const hasSubmittableChange = Object.keys(changedCredentials()).length > 0
    // 声明键全部已设 → 无草稿也可发起验证（用已存凭据检查连通性，是验证连接的主要场景）
    const hasStoredCredentials = keys.every((key) => provider.credentials[key]?.set)
    const canVerify = hasSubmittableChange || hasStoredCredentials

    /** 保存：成功 toast 由本组件弹（saved），失败静默保持编辑态（上层已弹 error） */
    const handleSave = async () => {
        setSaving(true)
        try {
            const ok = await onSave(changedCredentials())
            if (ok) {
                message.success(t('settings.webTools.saved'))
                setEditing(false)
                setVerifyResult(null)
            }
        } finally {
            setSaving(false)
        }
    }

    /** 验证连接：结果内联呈现（成功带耗时，失败显示 error 文案），不打断编辑态 */
    const handleVerify = async () => {
        setVerifying(true)
        try {
            setVerifyResult(await onVerify(changedCredentials()))
        } finally {
            setVerifying(false)
        }
    }

    return (
        <EditorBox $token={token}>
            {keys.map((key) => {
                const inputId = `cred-${key}`
                const set = provider.credentials[key]?.set ?? false
                return (
                    <FieldRow key={key}>
                        <FieldLabel $token={token} htmlFor={inputId}>
                            {t(`settings.webTools.${key}`)}
                            <SetBadge $token={token} $set={set}>
                                {set ? t('settings.webTools.credentialSet') : t('settings.webTools.credentialUnset')}
                            </SetBadge>
                        </FieldLabel>
                        <Input
                            id={inputId}
                            size="small"
                            // aria-label 独立于可见 label（后者还含 set 状态文案，不能作为可访问名整体）
                            aria-label={t(`settings.webTools.${key}`)}
                            readOnly={!editing}
                            // 预览态始终显示 props 派生的掩码串：保存成功后 Section reload 重读 preview，
                            // 编辑器不重挂载也能跟随新掩码，绝不残留用户输入的明文草稿
                            value={editing ? draft[key] ?? '' : initialPreview[key] ?? ''}
                            onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                            placeholder={t('settings.webTools.apiKeyPlaceholder')}
                            autoComplete="new-password"
                        />
                    </FieldRow>
                )
            })}

            <Actions $token={token}>
                {editing ? (
                    <>
                        <Button
                            size="small"
                            icon={<ShieldCheck size={14} />}
                            loading={verifying}
                            // 空草稿且无已存凭据 → 无可验证对象；有已存凭据时空草稿 = 用已存值验证
                            disabled={!canVerify}
                            onClick={() => {
                                void handleVerify()
                            }}
                        >
                            {t('settings.webTools.verify')}
                        </Button>
                        <Button size="small" onClick={cancelEditing}>
                            {t('settings.webTools.cancel')}
                        </Button>
                        <Button
                            size="small"
                            type="primary"
                            loading={saving}
                            // 空草稿无可保存的凭据变更，禁用防空串提交（写侧会静默保持旧值，却弹「已保存」误导）
                            disabled={!hasSubmittableChange}
                            onClick={() => {
                                void handleSave()
                            }}
                        >
                            {t('settings.webTools.save')}
                        </Button>
                    </>
                ) : (
                    <>
                        {/* 预览态也提供验证（用已存凭据检查连通性——验证已落盘 key 是本按钮的主要场景） */}
                        <Button
                            size="small"
                            icon={<ShieldCheck size={14} />}
                            loading={verifying}
                            onClick={() => {
                                void handleVerify()
                            }}
                        >
                            {t('settings.webTools.verify')}
                        </Button>
                        <Button size="small" type="primary" onClick={startEditing}>
                            {t('settings.webTools.replace')}
                        </Button>
                    </>
                )}
                {verifyResult !== null && (
                    <VerifyOutcome $token={token} $ok={verifyResult.success}>
                        {verifyResult.success
                            ? t('settings.webTools.verifyOk', { ms: String(verifyResult.latencyMs) })
                            : verifyResult.error}
                    </VerifyOutcome>
                )}
            </Actions>
        </EditorBox>
    )
}
