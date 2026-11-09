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
import { Alert, App, Input, Tag, theme as antTheme } from 'antd'
import { AppTooltip } from '@/ui/base/interactive/AppTooltip'
import { Button } from '@/ui/base/interactive/button/Button'
import { IconButton } from '@/ui/base/interactive/IconButton'
// uiarc 自管件：单选/可搜索选择（antd Select 已全站清零；tags 模式归 MultiSelect mode="tags"）
import { Select as UiSelect } from '@/ui/base/interactive/select/Select'
import { MultiSelect } from '@/ui/base/interactive/multi-select/MultiSelect'
import { Combobox } from '@/ui/base/interactive/combobox/Combobox'
import { useTranslation } from 'react-i18next'
import { Brain, ExternalLink, Plus, Trash2 } from 'lucide-react'
import styled from '@emotion/styled'
import type { MemoryAutoInjectMode, MemoryEndpointCheckResult, MemoryRule, MemorySettingsSubmission } from '@mobi/shared'
import { deriveMemoryUiUrl, HINDSIGHT_CLOUD_API_URL, isOffMachineEndpoint, parseEndpointUrl } from '@mobi/shared'
import { toDraft, useMemorySettings } from '@/core/data/hooks/queries/useMemorySettings'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SettingRow } from '@/features/settings/blocks/SettingRow'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Wrap = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: enter 0.25s ease;
`

/** 组卡内说明行（灰字，占卡内首行——与行式形态的行下说明同语言） */
const CardHint = styled.div<{ $token: Token }>`
    padding: 10px 16px 2px;
    font-size: 12px;
    line-height: 1.5;
    color: ${p => p.$token.colorTextTertiary};
`

/** 隔离规则行的操作区：档位选择 + 条件覆盖输入 + 删除（换行容纳窄屏） */
const RuleActions = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
`

const ExternalHint = styled.a<{ $token: Token }>`
    font-size: 12px;
    color: ${p => p.$token.colorTextTertiary};
    word-break: break-all;
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
        return <AppTooltip title={result.reason}><Tag color="error">{t('settings.memory.checkServerError')}</Tag></AppTooltip>
    }
    return <AppTooltip title={result.reason || undefined}><Tag color="warning">{t('settings.memory.checkUnreachable')}</Tag></AppTooltip>
}

/**
 * 长期记忆子页（SettingRow 行式形态，票06：显式保存页 → 即改即存行式）。
 *
 * 保存时机随行控件走（引擎/注入/规则/排除 = 动作即落盘；地址/Token/库名/刷新间隔 = 失焦落盘），
 * 部分字段提交由 Submission 协议的 merge 语义承载（读写协议零改动）。
 * 「下个新会话生效」语义不变（落盘即完成，daemon spawn 现读）。
 */
export function MemorySection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message } = App.useApp()
    const { settings, loaded, offline, save, check } = useMemorySettings()
    const workspacesQuery = useWorkspaces()

    // 表单草稿（可变输入——最小标识外状态，非派生对象）
    const [engine, setEngine] = useState<'off' | 'hindsight'>('off')
    const [endpoint, setEndpoint] = useState('')
    const [tokenDraft, setTokenDraft] = useState('')
    const [rules, setRules] = useState<MemoryRule[]>([])
    const [bankName, setBankName] = useState('')
    const [disabledWorkspaces, setDisabledWorkspaces] = useState<string[]>([])
    // 注入策略草稿（mobi 默认关：不自动注入 + 不刷目录；要在设置里显式开）
    const [autoInject, setAutoInject] = useState<MemoryAutoInjectMode>('none')
    const [refreshDraft, setRefreshDraft] = useState('0')
    const [checkResult, setCheckResult] = useState<MemoryEndpointCheckResult | null>(null)
    // 高级路径规则输入（行内，不默认占屏）
    const [pathDraft, setPathDraft] = useState('')
    // 已存基线：失焦落盘只在草稿偏离基线时发请求（幂等 merge 下避免无谓写盘）
    const [endpointBaseline, setEndpointBaseline] = useState('')
    const [bankBaseline, setBankBaseline] = useState('')
    const [refreshBaseline, setRefreshBaseline] = useState(0)

    // 加载完成后初始化草稿一次（invalidate 重读不重置——编辑中的草稿不丢，对齐 webTools 语义）
    const [initialized, setInitialized] = useState(false)
    useEffect(() => {
        if (!loaded || initialized) return
        const draft = toDraft(settings)
        setEngine(draft.engine === 'hindsight' ? 'hindsight' : 'off')
        setEndpoint(draft.endpoint ?? '')
        setEndpointBaseline(draft.endpoint ?? '')
        setRules(draft.rules ?? [])
        setBankName(draft.bankName ?? '')
        setBankBaseline(draft.bankName ?? '')
        setDisabledWorkspaces(draft.disabledWorkspaces ?? [])
        setAutoInject(draft.autoInject ?? 'none')
        setRefreshDraft(String(draft.pageRefreshEveryTurns ?? 0))
        setRefreshBaseline(draft.pageRefreshEveryTurns ?? 0)
        setInitialized(true)
    }, [loaded, initialized, settings])

    /** 部分字段落盘（Submission merge 协议），失败统一 toast；返回是否成功 */
    const savePartial = async (patch: MemorySettingsSubmission) => {
        const result = await save(patch)
        if (!result.ok) message.error(result.error || t('settings.memory.saveFailed'))
        return result.ok
    }

    if (!loaded) {
        return (
            <Wrap>
                {offline && <Alert type="warning" showIcon message={t('settings.memory.loadFailed')} />}
                <Placeholder />
            </Wrap>
        )
    }

    const hindsight = engine === 'hindsight'
    const uiUrl = deriveMemoryUiUrl(endpoint)
    const offMachine = hindsight && isOffMachineEndpoint(endpoint)
    // workspace 排除下拉可选项：全部工作区 folder 路径（tags 模式仍可自由输入任意路径）。
    // chip 完整显示路径（放不下换行，超容器宽才截断 + 悬停全值），不做任何短化猜测
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

    /** 引擎切换：动作即落盘（hindsight 态 endpoint 未填不拦截——spawn 裁决侧 fail-closed 兜底，填地址行就在旁边） */
    const switchEngine = (v: 'off' | 'hindsight') => {
        setEngine(v)
        setCheckResult(null)
        void savePartial({ engine: v })
    }

    /** 地址失焦落盘：hindsight 态沿用原前端校验（必填 + 带协议 URL），失败不落盘、草稿保持让用户改 */
    const saveEndpoint = async () => {
        if (endpoint === endpointBaseline) return
        if (!endpoint.trim()) {
            message.error(t('settings.memory.endpointRequired'))
            return
        }
        if (!parseEndpointUrl(endpoint)) {
            message.error(t('settings.memory.endpointInvalid'))
            return
        }
        if (await savePartial({ endpoint: endpoint.trim() })) setEndpointBaseline(endpoint.trim())
    }

    /** Token 失焦落盘：非空才携带（在场性协议：不在场 = 保持旧值），成功清空草稿 */
    const saveToken = async () => {
        const trimmed = tokenDraft.trim()
        if (!trimmed) return
        if (await savePartial({ apiToken: trimmed })) setTokenDraft('')
    }

    /** 清除已存 token：显式提交空串（在场性协议：空串 = 清除） */
    const clearToken = async () => {
        if (await savePartial({ apiToken: '' })) message.success(t('settings.memory.tokenCleared'))
    }

    /** 规则任何变更（增删改）即落盘 */
    const updateRules = (next: MemoryRule[]) => {
        setRules(next)
        void savePartial({ rules: next })
    }

    /** 库名失焦落盘：空串走 merge 清除语义（协议不变） */
    const saveBankName = async () => {
        if (bankName === bankBaseline) return
        if (await savePartial({ bankName })) setBankBaseline(bankName)
    }

    /** 注入模式切换：动作即落盘 */
    const switchAutoInject = (v: MemoryAutoInjectMode) => {
        setAutoInject(v)
        void savePartial({ autoInject: v })
    }

    /** 刷新间隔失焦落盘：整数化语义不变（小数取整、清空回落 0——不落 1「每轮」） */
    const saveRefresh = async () => {
        const n = Math.max(0, Math.round(Number(refreshDraft) || 0))
        setRefreshDraft(String(n))
        if (n === refreshBaseline) return
        if (await savePartial({ pageRefreshEveryTurns: n })) setRefreshBaseline(n)
    }

    return (
        <Wrap>
            <SettingGroupCard>
                <SettingRow
                    icon={Brain}
                    label={t('settings.memory.engineTitle')}
                    variant="inline-select"
                    description={hindsight ? t('settings.memory.savedHint') : t('settings.memory.privacyHint')}
                    select={{
                        value: engine,
                        ariaLabel: t('settings.memory.engineTitle'),
                        onValueChange: (v) => switchEngine(v === 'hindsight' ? 'hindsight' : 'off'),
                        options: [
                            { value: 'off', label: t('settings.memory.engineOff') },
                            { value: 'hindsight', label: t('settings.memory.engineHindsight') },
                        ],
                    }}
                />
                {hindsight && (
                    <SettingRow
                        label={t('settings.memory.endpointLabel')}
                        variant="input"
                        input={{
                            value: endpoint,
                            onChange: (e) => { setEndpoint(e.target.value); setCheckResult(null) },
                            onBlur: saveEndpoint,
                            onPressEnter: saveEndpoint,
                            placeholder: HINDSIGHT_CLOUD_API_URL,
                        }}
                    />
                )}
                {offMachine && (
                    <Alert type="warning" showIcon banner message={t('settings.memory.offMachineWarning')} />
                )}
                {hindsight && (
                    <SettingRow
                        label={t('settings.memory.tokenLabel')}
                        variant="input"
                        secret
                        description={settings?.apiTokenSet ? t('settings.memory.tokenSetPlaceholder') : undefined}
                        input={{
                            value: tokenDraft,
                            onChange: (e) => setTokenDraft(e.target.value),
                            onBlur: saveToken,
                            onPressEnter: saveToken,
                            placeholder: settings?.apiTokenSet
                                ? t('settings.memory.tokenSetPlaceholder')
                                : t('settings.memory.tokenUnsetPlaceholder'),
                            autoComplete: 'new-password',
                        }}
                    />
                )}
                {hindsight && settings?.apiTokenSet && (
                    <SettingRow
                        label={t('settings.memory.tokenClear')}
                        variant="action"
                        action={
                            <Button variant="ghost" size="sm" onClick={() => { void clearToken() }}>
                                {t('settings.memory.clear')}
                            </Button>
                        }
                    />
                )}
                {hindsight && (
                    <SettingRow
                        label={t('settings.memory.statusTitle')}
                        variant="action"
                        action={
                            <>
                                <Button variant="secondary" size="sm" onClick={() => { void handleCheck() }} disabled={!endpoint.trim()}>
                                    {t('settings.memory.checkButton')}
                                </Button>
                                {checkResult && <CheckResultView result={checkResult} t={t} />}
                            </>
                        }
                    />
                )}
                {hindsight && uiUrl && (
                    <SettingRow
                        label={t('settings.memory.openUi')}
                        variant="navigate"
                        description={<ExternalHint $token={token} href={uiUrl} target="_blank" rel="noreferrer">{uiUrl} <ExternalLink size={12} style={{ verticalAlign: -1.5 }} /></ExternalHint>}
                        onClick={() => { window.open(uiUrl, '_blank', 'noreferrer') }}
                    />
                )}
            </SettingGroupCard>

            {hindsight && (
                <SettingGroupCard title={t('settings.memory.mapTitle')}>
                    <CardHint $token={token}>{t('settings.memory.mapHint')}</CardHint>
                    {rules.map((rule, i) => (
                        <SettingRow
                            key={i}
                            label={rule.target.type === 'workspace' ? workspaceNameOf(rule.target.id) : rule.target.path}
                            description={t(`settings.memory.mode${rule.mode.charAt(0).toUpperCase()}${rule.mode.slice(1)}Hint`)}
                            variant="action"
                            action={
                                <RuleActions>
                                    <UiSelect
                                        style={{ width: 120 }}
                                        ariaLabel={t('settings.memory.mapTitle')}
                                        value={rule.mode}
                                        onValueChange={(mode) => updateRules(rules.map((x, j) => j === i
                                            ? { ...x, mode, ...(mode !== 'normal' ? { tag: undefined } : {}), ...(mode !== 'isolated' ? { bank: undefined } : {}) }
                                            : x))}
                                        options={[
                                            { value: 'normal', label: t('settings.memory.modeNormal'), title: t('settings.memory.modeNormalHint') },
                                            { value: 'open', label: t('settings.memory.modeOpen'), title: t('settings.memory.modeOpenHint') },
                                            { value: 'isolated', label: t('settings.memory.modeIsolated'), title: t('settings.memory.modeIsolatedHint') },
                                        ]}
                                    />
                                    {rule.mode === 'normal' && (
                                        <AppTooltip title={t('settings.memory.tagPlaceholder')}>
                                            <Input
                                                size="small"
                                                style={{ width: 150 }}
                                                value={rule.tag ?? ''}
                                                onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, tag: e.target.value.trim() || undefined } : x))}
                                                onBlur={() => updateRules(rules)}
                                                placeholder={t('settings.memory.tagLabel')}
                                                aria-label={t('settings.memory.tagLabel')}
                                            />
                                        </AppTooltip>
                                    )}
                                    {rule.mode === 'isolated' && (
                                        <AppTooltip title={t('settings.memory.bankPlaceholder')}>
                                            <Input
                                                size="small"
                                                style={{ width: 150 }}
                                                value={rule.bank ?? ''}
                                                onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, bank: e.target.value.trim() || undefined } : x))}
                                                onBlur={() => updateRules(rules)}
                                                placeholder={t('settings.memory.bankLabel')}
                                                aria-label={t('settings.memory.bankLabel')}
                                            />
                                        </AppTooltip>
                                    )}
                                    <IconButton
                                        icon={<Trash2 size={14} />} size={22}
                                        aria-label={t('settings.memory.ruleRemove')}
                                        onClick={() => updateRules(rules.filter((_, j) => j !== i))}
                                    />
                                </RuleActions>
                            }
                        />
                    ))}
                    {/* 恒占位 picker：选中即建规则，value 恒 ""（回显交由规则行） */}
                    <SettingRow
                        label={t('settings.memory.ruleAddWorkspace')}
                        variant="action"
                        action={
                            <Combobox
                                style={{ minWidth: 200 }}
                                value=""
                                aria-label={t('settings.memory.ruleAddWorkspace')}
                                placeholder={t('settings.memory.ruleAddWorkspace')}
                                options={addableWorkspaces}
                                onValueChange={(id) => {
                                    if (id) updateRules([...rules, { target: { type: 'workspace', id }, mode: 'normal' }])
                                }}
                            />
                        }
                    />
                    <SettingRow
                        label={t('settings.memory.ruleAddPath')}
                        variant="action"
                        action={
                            <>
                                <Input
                                    size="small"
                                    style={{ width: 220 }}
                                    value={pathDraft}
                                    onChange={(e) => setPathDraft(e.target.value)}
                                    onPressEnter={addPathRule}
                                    placeholder={t('settings.memory.rulePathPlaceholder')}
                                    aria-label={t('settings.memory.ruleAddPath')}
                                />
                                <Button variant="ghost" size="sm" onClick={addPathRule}>
                                    <Plus size={13} /> {t('settings.memory.add')}
                                </Button>
                            </>
                        }
                    />
                    <SettingRow
                        label={t('settings.memory.bankNameLabel')}
                        variant="input"
                        description={t('settings.memory.bankNameHint')}
                        input={{
                            value: bankName,
                            onChange: (e) => setBankName(e.target.value),
                            onBlur: saveBankName,
                            onPressEnter: saveBankName,
                            placeholder: t('settings.memory.bankNamePlaceholder'),
                        }}
                    />
                </SettingGroupCard>
            )}

            {hindsight && (
                <SettingGroupCard title={t('settings.memory.injectTitle')}>
                    <CardHint $token={token}>{t('settings.memory.injectHint')}</CardHint>
                    <SettingRow
                        label={t('settings.memory.injectModeLabel')}
                        variant="inline-select"
                        select={{
                            value: autoInject,
                            ariaLabel: t('settings.memory.injectModeLabel'),
                            onValueChange: (v) => switchAutoInject(v as MemoryAutoInjectMode),
                            options: [
                                { value: 'reflect', label: t('settings.memory.injectReflect'), title: t('settings.memory.injectReflectHint') },
                                { value: 'recall', label: t('settings.memory.injectRecall'), title: t('settings.memory.injectRecallHint') },
                                { value: 'pages', label: t('settings.memory.injectPages'), title: t('settings.memory.injectPagesHint') },
                                { value: 'none', label: t('settings.memory.injectNone'), title: t('settings.memory.injectNoneHint') },
                            ],
                        }}
                    />
                    <SettingRow
                        label={t('settings.memory.pageRefreshLabel')}
                        variant="input"
                        description={t('settings.memory.pageRefreshHint')}
                        input={{
                            value: refreshDraft,
                            onChange: (e) => setRefreshDraft(e.target.value),
                            onBlur: saveRefresh,
                            onPressEnter: saveRefresh,
                            inputMode: 'numeric',
                        }}
                    />
                </SettingGroupCard>
            )}

            <SettingGroupCard title={t('settings.memory.excludedTitle')}>
                <CardHint $token={token}>{t('settings.memory.excludedHint')}</CardHint>
                <div style={{ padding: '10px 16px 14px' }}>
                    <MultiSelect
                        mode="tags"
                        value={disabledWorkspaces}
                        onValueChange={(next) => { setDisabledWorkspaces(next); void savePartial({ disabledWorkspaces: next }) }}
                        options={workspaceOptions}
                        placeholder={t('settings.memory.excludedPlaceholder')}
                        ariaLabel={t('settings.memory.excludedTitle')}
                    />
                </div>
            </SettingGroupCard>
        </Wrap>
    )

    /** 按路径添加规则（输入非空才建，成功清空输入） */
    function addPathRule() {
        const p = pathDraft.trim()
        if (p) {
            updateRules([...rules, { target: { type: 'path', path: p }, mode: 'normal' }])
            setPathDraft('')
        }
    }

    /** 连接检查（草稿值；token 不在场 daemon 用已存值兜底） */
    async function handleCheck() {
        if (!endpoint.trim()) {
            message.warning(t('settings.memory.endpointRequired'))
            return
        }
        setCheckResult(await check({ endpoint, ...(tokenDraft.trim() ? { apiToken: tokenDraft.trim() } : {}) }))
    }
}

/** 空占位：首次加载中保持子页高度，避免布局跳动（对齐 WebToolsSection 的 Placeholder 语义） */
const Placeholder = styled.div`
    min-height: 200px;
`
