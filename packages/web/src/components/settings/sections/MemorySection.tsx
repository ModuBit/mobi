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

import { useEffect, useState } from 'react'
import { Alert, App, Button, Input, Radio, Select, Tag, theme as antTheme, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import { Brain, ExternalLink, Plus, Trash2 } from 'lucide-react'
import styled from '@emotion/styled'
import type { MemoryEndpointCheckResult, MemoryRule } from '@mobi/shared'
import { SettingsCard } from '@/components/settings/blocks/shared'
import { toDraft, useMemorySettings } from '@/core/data/hooks/queries/useMemorySettings'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

/** Cloud 默认 API 地址（endpoint 输入占位提示） */
export const HINDSIGHT_CLOUD_API_URL = 'https://api.hindsight.vectorize.io'

/** 主机名是否指向本机（不出本机的判定） */
export function isLocalHostname(hostname: string): boolean {
    return ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'].includes(hostname)
}

/** endpoint 是否会把记忆数据送出本机（合法 URL 且主机非本机 → 提示「数据将离开本机」） */
export function isOffMachineEndpoint(endpoint: string): boolean {
    try {
        return !isLocalHostname(new URL(endpoint.trim()).hostname)
    } catch {
        return false
    }
}

/**
 * 「打开记忆界面」链接（纯函数）：
 * Cloud（hindsight.vectorize.io 域）→ 官方 dashboard；self-host → 同主机 9999 端口
 * （UI 端口规则见票 01 VENDOR-NOTES 实测）。非法/空 endpoint → null（不渲染链接）。
 */
export function deriveMemoryUiUrl(endpoint: string): string | null {
    const trimmed = endpoint.trim()
    if (!trimmed) return null
    try {
        const url = new URL(trimmed)
        if (url.hostname === 'hindsight.vectorize.io' || url.hostname.endsWith('.hindsight.vectorize.io')) {
            return 'https://ui.hindsight.vectorize.io'
        }
        return `${url.protocol}//${url.hostname}:9999`
    } catch {
        return null
    }
}

const Wrap = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: enter 0.25s ease;
`

const Card = styled(SettingsCard)<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px ${p => p.$token.padding}px;
`

const Title = styled.span<{ $token: Token }>`
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.01em;
    color: ${p => p.$token.colorText};
`

const FieldLabel = styled.label<{ $token: Token }>`
    font-size: 13px;
    color: ${p => p.$token.colorText};
    display: block;
    margin-bottom: 6px;
`

const Hint = styled.span<{ $token: Token }>`
    font-size: 11.5px;
    color: ${p => p.$token.colorTextTertiary};
    line-height: 1.5;
    display: block;
`

/** 隔离规则行：目标标签 + 档位选择 + 条件覆盖输入 + 删除（换行容纳窄屏） */
const RuleRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
`

/** 规则行内目标展示（workspace 名 / 路径），窄屏收缩 */
const RuleTarget = styled.span<{ $token: Token }>`
    font-size: 13px;
    color: ${p => p.$token.colorText};
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
`

const RowActions = styled.div`
    display: flex;
    gap: 8px;
    margin-top: 4px;
`

const Footer = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
`

/** 连接状态结果渲染（四态文案 + 耗时），检查按钮的伴随展示 */
function CheckResultView({ result, t }: { result: MemoryEndpointCheckResult; t: ReturnType<typeof useTranslation>['t'] }) {
    if (result.status === 'ok') {
        return <Tag color="success">{t('settings.memory.checkOk', { ms: result.latencyMs })}</Tag>
    }
    if (result.status === 'unauthorized') {
        return <Tag color="error">{t('settings.memory.checkUnauthorized')}</Tag>
    }
    if (result.status === 'error') {
        return <Tooltip title={result.reason}><Tag color="error">{t('settings.memory.checkServerError')}</Tag></Tooltip>
    }
    return <Tooltip title={result.reason || undefined}><Tag color="warning">{t('settings.memory.checkUnreachable')}</Tag></Tooltip>
}

/**
 * 长期记忆子页（agent-memory 票 03）：引擎单选 / endpoint / token / 路径映射 /
 * workspace 排除 / 连接检查 / 记忆界面链接。显式保存（保存后「下个新会话生效」）。
 */
export function MemorySection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message } = App.useApp()
    const { settings, loaded, saving, save, check } = useMemorySettings()
    const workspacesQuery = useWorkspaces()

    // 表单草稿（可变输入——最小标识外状态，非派生对象）
    const [engine, setEngine] = useState<'off' | 'hindsight'>('off')
    const [endpoint, setEndpoint] = useState('')
    const [tokenDraft, setTokenDraft] = useState('')
    const [rules, setRules] = useState<MemoryRule[]>([])
    const [bankName, setBankName] = useState('')
    const [disabledWorkspaces, setDisabledWorkspaces] = useState<string[]>([])
    const [checkResult, setCheckResult] = useState<MemoryEndpointCheckResult | null>(null)
    const [savedAt, setSavedAt] = useState(0)
    // 高级路径规则输入（折叠式，不默认占屏）
    const [pathDraft, setPathDraft] = useState('')

    // 加载完成后初始化草稿一次（invalidate 重读不重置——编辑中的草稿不丢，对齐 webTools 语义）
    const [initialized, setInitialized] = useState(false)
    useEffect(() => {
        if (!loaded || initialized) return
        const draft = toDraft(settings)
        setEngine(draft.engine === 'hindsight' ? 'hindsight' : 'off')
        setEndpoint(draft.endpoint ?? '')
        setRules(draft.rules ?? [])
        setBankName(draft.bankName ?? '')
        setDisabledWorkspaces(draft.disabledWorkspaces ?? [])
        setInitialized(true)
    }, [loaded, initialized, settings])

    if (!loaded) return <Placeholder />

    const uiUrl = deriveMemoryUiUrl(endpoint)
    const offMachine = engine === 'hindsight' && isOffMachineEndpoint(endpoint)
    // workspace 排除下拉可选项：全部工作区 folder 路径（tags 模式仍可自由输入任意路径）
    const workspaceOptions = Array.from(new Set(
        (workspacesQuery.data ?? []).flatMap((w) => w.folders.map((f) => f.path)),
    )).map((path) => ({ value: path, label: path }))
    // workspace id → 名（规则行目标展示）；folders 平铺去重
    const workspaceNameOf = (id: string): string =>
        workspacesQuery.data?.find((w) => w.id === id)?.name ?? id
    // 添加规则候选：未加过规则的 workspace（路径目标恒可加）
    const ruledWorkspaceIds = new Set(
        rules.flatMap((r) => (r.target.type === 'workspace' ? [r.target.id] : [])),
    )
    const addableWorkspaces = (workspacesQuery.data ?? [])
        .filter((w) => !ruledWorkspaceIds.has(w.id))
        .map((w) => ({ value: w.id, label: w.name }))

    /** 提交 payload：apiToken 在场性——草稿非空才携带（undefined = 保持旧值） */
    const buildSubmission = () => ({
        engine,
        endpoint: endpoint.trim(),
        rules,
        disabledWorkspaces,
        // bankName 恒提交（空串走 merge 清除语义）
        bankName,
        ...(tokenDraft.trim() ? { apiToken: tokenDraft.trim() } : {}),
    })

    const handleSave = async () => {
        if (engine === 'hindsight' && !endpoint.trim()) {
            message.error(t('settings.memory.endpointRequired'))
            return
        }
        const result = await save(buildSubmission())
        if (!result.ok) {
            message.error(result.error || t('settings.memory.saveFailed'))
            return
        }
        setTokenDraft('')
        setSavedAt(Date.now())
        message.success(t('settings.memory.savedHint'))
    }

    /** 清除已存 token：显式提交空串（在场性协议：空串 = 清除） */
    const handleClearToken = async () => {
        const result = await save({ apiToken: '' })
        if (!result.ok) {
            message.error(result.error || t('settings.memory.saveFailed'))
        } else {
            setTokenDraft('')
            message.success(t('settings.memory.tokenCleared'))
        }
    }

    const handleCheck = async () => {
        if (!endpoint.trim()) {
            message.warning(t('settings.memory.endpointRequired'))
            return
        }
        setCheckResult(await check({ endpoint, ...(tokenDraft.trim() ? { apiToken: tokenDraft.trim() } : {}) }))
    }

    return (
        <Wrap>
            <Card $token={token}>
                <Title $token={token}>
                    <Brain size={15} style={{ verticalAlign: -2.5, marginRight: 6 }} />
                    {t('settings.memory.engineTitle')}
                </Title>

                <Radio.Group
                    value={engine}
                    onChange={(e) => { setEngine(e.target.value); setCheckResult(null) }}
                    options={[
                        { value: 'off', label: t('settings.memory.engineOff') },
                        { value: 'hindsight', label: t('settings.memory.engineHindsight') },
                    ]}
                />
                {engine === 'off' ? (
                    <Hint $token={token}>{t('settings.memory.privacyHint')}</Hint>
                ) : (
                    <>
                        <div>
                            <FieldLabel $token={token}>{t('settings.memory.endpointLabel')}</FieldLabel>
                            <Input
                                value={endpoint}
                                onChange={(e) => { setEndpoint(e.target.value); setCheckResult(null) }}
                                placeholder={HINDSIGHT_CLOUD_API_URL}
                                aria-label={t('settings.memory.endpointLabel')}
                            />
                            {offMachine && (
                                <Alert type="warning" showIcon banner style={{ marginTop: 8 }}
                                    message={t('settings.memory.offMachineWarning')} />
                            )}
                        </div>

                        <div>
                            <FieldLabel $token={token}>{t('settings.memory.tokenLabel')}</FieldLabel>
                            <Input.Password
                                value={tokenDraft}
                                onChange={(e) => setTokenDraft(e.target.value)}
                                placeholder={settings?.apiTokenSet
                                    ? t('settings.memory.tokenSetPlaceholder')
                                    : t('settings.memory.tokenUnsetPlaceholder')}
                                aria-label={t('settings.memory.tokenLabel')}
                            />
                            {settings?.apiTokenSet && (
                                <Button size="small" type="text" style={{ marginTop: 4, padding: 0 }}
                                    onClick={() => { void handleClearToken() }}>
                                    {t('settings.memory.tokenClear')}
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </Card>

            {engine === 'hindsight' && (
                <Card $token={token}>
                    <Title $token={token}>{t('settings.memory.mapTitle')}</Title>
                    <Hint $token={token}>{t('settings.memory.mapHint')}</Hint>
                    {rules.map((rule, i) => (
                        <RuleRow key={i}>
                            <RuleTarget $token={token} title={rule.target.type === 'path' ? rule.target.path : undefined}>
                                {rule.target.type === 'workspace' ? workspaceNameOf(rule.target.id) : rule.target.path}
                            </RuleTarget>
                            <Select
                                size="small"
                                style={{ width: 120 }}
                                value={rule.mode}
                                onChange={(mode) => setRules(rules.map((x, j) => j === i
                                    ? { ...x, mode, ...(mode !== 'normal' ? { tag: undefined } : {}), ...(mode !== 'isolated' ? { bank: undefined } : {}) }
                                    : x))}
                                options={[
                                    { value: 'normal', label: t('settings.memory.modeNormal'), title: t('settings.memory.modeNormalHint') },
                                    { value: 'open', label: t('settings.memory.modeOpen'), title: t('settings.memory.modeOpenHint') },
                                    { value: 'isolated', label: t('settings.memory.modeIsolated'), title: t('settings.memory.modeIsolatedHint') },
                                ]}
                                aria-label={t('settings.memory.mapTitle')}
                            />
                            {rule.mode === 'normal' && (
                                <Tooltip title={t('settings.memory.tagPlaceholder')}>
                                    <Input
                                        size="small"
                                        style={{ width: 150 }}
                                        value={rule.tag ?? ''}
                                        onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, tag: e.target.value.trim() || undefined } : x))}
                                        placeholder={t('settings.memory.tagLabel')}
                                        aria-label={t('settings.memory.tagLabel')}
                                    />
                                </Tooltip>
                            )}
                            {rule.mode === 'isolated' && (
                                <Tooltip title={t('settings.memory.bankPlaceholder')}>
                                    <Input
                                        size="small"
                                        style={{ width: 150 }}
                                        value={rule.bank ?? ''}
                                        onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, bank: e.target.value.trim() || undefined } : x))}
                                        placeholder={t('settings.memory.bankLabel')}
                                        aria-label={t('settings.memory.bankLabel')}
                                    />
                                </Tooltip>
                            )}
                            <Button
                                type="text" size="small" aria-label={t('settings.memory.ruleRemove')}
                                icon={<Trash2 size={14} />}
                                onClick={() => setRules(rules.filter((_, j) => j !== i))}
                            />
                        </RuleRow>
                    ))}
                    <RowActions>
                        <Select
                            size="small"
                            style={{ minWidth: 200 }}
                            value={null}
                            placeholder={t('settings.memory.ruleAddWorkspace')}
                            options={addableWorkspaces}
                            showSearch
                            optionFilterProp="label"
                            onChange={(id) => {
                                if (typeof id === 'string') {
                                    setRules([...rules, { target: { type: 'workspace', id }, mode: 'normal' }])
                                }
                            }}
                            aria-label={t('settings.memory.ruleAddWorkspace')}
                        />
                        <Input
                            size="small"
                            style={{ width: 220 }}
                            value={pathDraft}
                            onChange={(e) => setPathDraft(e.target.value)}
                            placeholder={t('settings.memory.rulePathPlaceholder')}
                            aria-label={t('settings.memory.ruleAddPath')}
                        />
                        <Button size="small" type="dashed" icon={<Plus size={13} />}
                            onClick={() => {
                                const p = pathDraft.trim()
                                if (p) {
                                    setRules([...rules, { target: { type: 'path', path: p }, mode: 'normal' }])
                                    setPathDraft('')
                                }
                            }}>
                            {t('settings.memory.ruleAddPath')}
                        </Button>
                    </RowActions>
                    <RowActions>
                        <Tooltip title={t('settings.memory.bankNameHint')}>
                            <span style={{ fontSize: 12.5 }}>{t('settings.memory.bankNameLabel')}</span>
                        </Tooltip>
                        <Input
                            size="small"
                            style={{ width: 200 }}
                            value={bankName}
                            onChange={(e) => setBankName(e.target.value)}
                            placeholder={t('settings.memory.bankNamePlaceholder')}
                            aria-label={t('settings.memory.bankNameLabel')}
                        />
                    </RowActions>
                </Card>
            )}

            <Card $token={token}>
                <Title $token={token}>{t('settings.memory.excludedTitle')}</Title>
                <Hint $token={token}>{t('settings.memory.excludedHint')}</Hint>
                <Select
                    mode="tags"
                    style={{ width: '100%' }}
                    value={disabledWorkspaces}
                    onChange={(v) => setDisabledWorkspaces(v ?? [])}
                    options={workspaceOptions}
                    placeholder={t('settings.memory.excludedPlaceholder')}
                    open={false}
                    tokenSeparators={[',']}
                    aria-label={t('settings.memory.excludedTitle')}
                />
            </Card>

            <Card $token={token}>
                <Title $token={token}>{t('settings.memory.statusTitle')}</Title>
                <RowActions>
                    <Button size="small" onClick={() => { void handleCheck() }} disabled={!endpoint.trim()}>
                        {t('settings.memory.checkButton')}
                    </Button>
                    {checkResult && <CheckResultView result={checkResult} t={t} />}
                </RowActions>
                {uiUrl && (
                    <a href={uiUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
                        {t('settings.memory.openUi')} <ExternalLink size={12} style={{ verticalAlign: -1.5 }} />
                    </a>
                )}
            </Card>

            <Footer>
                <Button type="primary" loading={saving} onClick={() => { void handleSave() }}>
                    {t('settings.memory.saveButton')}
                </Button>
                {savedAt > 0 && <Hint $token={token}>{t('settings.memory.savedHint')}</Hint>}
            </Footer>
        </Wrap>
    )
}

/** 空占位：首次加载中保持子页高度，避免布局跳动（对齐 WebToolsSection 的 Placeholder 语义） */
const Placeholder = styled.div`
    min-height: 200px;
`
