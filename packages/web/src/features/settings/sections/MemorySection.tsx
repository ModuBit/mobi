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

import { useMemo, useState } from 'react'
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
import { enter, ENTER_DURATION, ENTER_EASING } from '@/features/settings/blocks/shared'
import { deriveMemoryUiUrl, HINDSIGHT_CLOUD_API_URL, isOffMachineEndpoint, parseEndpointUrl } from '@mobi/shared'
import { toDraft, useMemorySettings } from '@/core/data/hooks/queries/useMemorySettings'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { CardHint } from '@/features/settings/blocks/CardHint'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SettingRow } from '@/features/settings/blocks/SettingRow'
import { useSettingsDraft } from '@/features/settings/useSettingsDraft'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Wrap = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: ${enter} ${ENTER_DURATION} ${ENTER_EASING};
`

/** 隔离规则行的操作区：档位选择 + 条件覆盖输入 + 删除（换行容纳窄屏） */
const RuleActions = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
`

/** URL 展示（纯文本：导航行为归 NavRow 整行 onClick 单一触发——button 内嵌 anchor 违反 HTML 规范且双开） */
const ExternalHint = styled.span<{ $token: Token }>`
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

/** 记忆草稿形状（apiToken 为 write-only 草稿，写后清空；pageRefresh 为字符串草稿，失焦整数化） */
type MemoryDraft = {
    engine: 'off' | 'hindsight'
    endpoint: string
    apiToken: string
    rules: MemoryRule[]
    bankName: string
    disabledWorkspaces: string[]
    autoInject: MemoryAutoInjectMode
    pageRefresh: string
}

/**
 * 记忆提交内容构造（分区不变式所在）：地址/库名/规则偏离基线才提交；token 非空才携带
 * （在场性协议：不在场 = 保持旧值）；刷新间隔整数化后偏离才提交。
 * 校验失败返回 error（走 hook 的失败呈现，草稿保持让用户改）。
 * 清除已存 token 是语义动作，分区直调 save（见 clearToken），不走本构造。
 */
function buildMemoryPayload(
    key: string,
    draft: MemoryDraft,
    baseline: MemoryDraft,
    t: (k: string) => string,
): MemorySettingsSubmission | Record<string, unknown> | null | { error: string } {
    switch (key) {
        case 'engine':
            return { engine: draft.engine }
        case 'endpoint': {
            if (draft.endpoint === baseline.endpoint) return null
            if (!draft.endpoint.trim()) return { error: t('settings.memory.endpointRequired') }
            if (!parseEndpointUrl(draft.endpoint)) return { error: t('settings.memory.endpointInvalid') }
            return { endpoint: draft.endpoint.trim() }
        }
        case 'apiToken': {
            const trimmed = draft.apiToken.trim()
            return trimmed ? { apiToken: trimmed } : null
        }
        case 'rules':
            // 偏离基线才提交（基线推进后与草稿同引用）：tag/bank 失焦未改动不发请求，
            // 点删除时 blur+click 也不再连发两笔（blur 判 null，只落删除那一笔）
            return draft.rules === baseline.rules ? null : { rules: draft.rules }
        case 'bankName':
            return draft.bankName === baseline.bankName ? null : { bankName: draft.bankName }
        case 'autoInject':
            return { autoInject: draft.autoInject }
        case 'pageRefresh': {
            const n = Math.max(0, Math.round(Number(draft.pageRefresh) || 0))
            return n === Number(baseline.pageRefresh) ? null : { pageRefreshEveryTurns: n }
        }
        case 'disabledWorkspaces':
            return { disabledWorkspaces: draft.disabledWorkspaces }
        default:
            return null
    }
}

/**
 * 长期记忆子页（SettingRow 行式形态）。草稿—落盘纪律由 useSettingsDraft 承载，
 * 分区只声明字段投影与提交内容构造（buildMemoryPayload）。
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

    // 字段投影共享一份（toDraft 深拷贝 rules/disabledWorkspaces，逐字段投影会重复拷贝 8 次）；
    // 投影只发生在 loaded 后初始化那一次，invalidate 重读仅更新此 memo、不影响已初始化的草稿
    const projected = useMemo(() => toDraft(settings ?? null), [settings])

    const draftApi = useSettingsDraft<MemoryDraft, Parameters<typeof toDraft>[0]>({
        loaded,
        settings: settings ?? null,
        errorFallbackKey: 'settings.memory.saveFailed',
        fields: {
            engine: { from: () => (projected.engine === 'hindsight' ? 'hindsight' : 'off') },
            endpoint: {
                from: () => projected.endpoint ?? '',
                // 地址编辑即清上次的连接检查结果（旧结果对应旧地址，留着误导）——编辑副作用收进字段声明
                onEdit: () => setCheckResult(null),
            },
            apiToken: { from: () => '', onSaved: ({ reset }) => reset('') },
            rules: { from: () => projected.rules ?? [] },
            bankName: { from: () => projected.bankName ?? '' },
            disabledWorkspaces: { from: () => projected.disabledWorkspaces ?? [] },
            autoInject: { from: () => projected.autoInject ?? 'none' },
            pageRefresh: {
                from: () => String(projected.pageRefreshEveryTurns ?? 0),
                // 失焦整数化显示（小数取整、清空回落 0——不落 1「每轮」），规范化值参与 payload 判定
                normalize: (v) => String(Math.max(0, Math.round(Number(v) || 0))),
            },
        },
        buildPayload: (key, draft, baseline) => buildMemoryPayload(key, draft, baseline, t),
        save,
    })

    // 纯本地展示态（不入草稿 schema）：连接检查结果与高级路径规则输入行内草稿
    const [checkResult, setCheckResult] = useState<MemoryEndpointCheckResult | null>(null)
    const [pathDraft, setPathDraft] = useState('')

    if (!loaded) {
        return (
            <Wrap>
                {offline && <Alert type="warning" showIcon title={t('settings.memory.loadFailed')} />}
                <Placeholder />
            </Wrap>
        )
    }

    const { draft } = draftApi
    const { rules } = draft

    const hindsight = draft.engine === 'hindsight'
    const uiUrl = deriveMemoryUiUrl(draft.endpoint)
    const offMachine = hindsight && isOffMachineEndpoint(draft.endpoint)
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
        setCheckResult(null)
        void draftApi.commit('engine', { engine: v })
    }

    /** 清除已存 token：语义动作直调落盘（成功提示是本动作的一部分，不走草稿纪律）；失败弹原因 */
    const clearToken = async () => {
        const result = await save({ apiToken: '' })
        if (result.ok) message.success(t('settings.memory.tokenCleared'))
        else message.error(result.error || t('settings.memory.saveFailed'))
    }

    /** 按路径添加规则（输入非空才建；清空输入框等落盘成功后——失败保住键入可改） */
    const addPathRule = () => {
        const p = pathDraft.trim()
        if (!p) return
        void draftApi.commit('rules', { rules: [...rules, { target: { type: 'path', path: p }, mode: 'normal' }] })
            .then((ok) => { if (ok) setPathDraft('') })
    }

    /** 连接检查（草稿值；token 不在场 daemon 用已存值兜底） */
    const handleCheck = async () => {
        if (!draft.endpoint.trim()) {
            message.warning(t('settings.memory.endpointRequired'))
            return
        }
        setCheckResult(await check({ endpoint: draft.endpoint, ...(draft.apiToken.trim() ? { apiToken: draft.apiToken.trim() } : {}) }))
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
                        value: draft.engine,
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
                            ...draftApi.bindInput('endpoint'),
                            placeholder: HINDSIGHT_CLOUD_API_URL,
                        }}
                    />
                )}
                {offMachine && (
                    <Alert type="warning" showIcon banner title={t('settings.memory.offMachineWarning')} />
                )}
                {hindsight && (
                    <SettingRow
                        label={t('settings.memory.tokenLabel')}
                        variant="input"
                        secret
                        description={settings?.apiTokenSet ? t('settings.memory.tokenSetPlaceholder') : undefined}
                        input={{
                            ...draftApi.bindInput('apiToken'),
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
                                <Button variant="secondary" size="sm" onClick={() => { void handleCheck() }} disabled={!draft.endpoint.trim()}>
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
                        description={<ExternalHint $token={token}>{uiUrl} <ExternalLink size={12} style={{ verticalAlign: -1.5 }} /></ExternalHint>}
                        onClick={() => { window.open(uiUrl, '_blank', 'noreferrer') }}
                    />
                )}
            </SettingGroupCard>

            {hindsight && (
                <SettingGroupCard title={t('settings.memory.mapTitle')}>
                    <CardHint pad="10px 16px 2px">{t('settings.memory.mapHint')}</CardHint>
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
                                        onValueChange={(mode) => { void draftApi.commit('rules', { rules: rules.map((x, j) => j === i
                                            ? { ...x, mode, ...(mode !== 'normal' ? { tag: undefined } : {}), ...(mode !== 'isolated' ? { bank: undefined } : {}) }
                                            : x) }) }}
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
                                                onChange={(e) => draftApi.setDraft({ rules: rules.map((x, j) => j === i ? { ...x, tag: e.target.value.trim() || undefined } : x) })}
                                                onBlur={() => { void draftApi.commit('rules') }}
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
                                                onChange={(e) => draftApi.setDraft({ rules: rules.map((x, j) => j === i ? { ...x, bank: e.target.value.trim() || undefined } : x) })}
                                                onBlur={() => { void draftApi.commit('rules') }}
                                                placeholder={t('settings.memory.bankLabel')}
                                                aria-label={t('settings.memory.bankLabel')}
                                            />
                                        </AppTooltip>
                                    )}
                                    <IconButton
                                        // 32：与同行 select 视觉高度对齐；22 的图标钮热区触屏点不中
                                        icon={<Trash2 size={14} />} size={32}
                                        aria-label={t('settings.memory.ruleRemove')}
                                        onClick={() => { void draftApi.commit('rules', { rules: rules.filter((_, j) => j !== i) }) }}
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
                                    if (id) void draftApi.commit('rules', { rules: [...rules, { target: { type: 'workspace', id }, mode: 'normal' }] })
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
                            ...draftApi.bindInput('bankName'),
                            placeholder: t('settings.memory.bankNamePlaceholder'),
                        }}
                    />
                </SettingGroupCard>
            )}

            {hindsight && (
                <SettingGroupCard title={t('settings.memory.injectTitle')}>
                    <CardHint pad="10px 16px 2px">{t('settings.memory.injectHint')}</CardHint>
                    <SettingRow
                        label={t('settings.memory.injectModeLabel')}
                        variant="inline-select"
                        select={{
                            value: draft.autoInject,
                            ariaLabel: t('settings.memory.injectModeLabel'),
                            onValueChange: (v) => { void draftApi.commit('autoInject', { autoInject: v as MemoryAutoInjectMode }) },
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
                            ...draftApi.bindInput('pageRefresh'),
                            inputMode: 'numeric',
                        }}
                    />
                </SettingGroupCard>
            )}

            <SettingGroupCard title={t('settings.memory.excludedTitle')}>
                <CardHint pad="10px 16px 2px">{t('settings.memory.excludedHint')}</CardHint>
                <div style={{ padding: '10px 16px 14px' }}>
                    <MultiSelect
                        mode="tags"
                        value={draft.disabledWorkspaces}
                        onValueChange={(next) => { void draftApi.commit('disabledWorkspaces', { disabledWorkspaces: next }) }}
                        options={workspaceOptions}
                        placeholder={t('settings.memory.excludedPlaceholder')}
                        ariaLabel={t('settings.memory.excludedTitle')}
                        emptyMessage={t('settings.memory.excludedEmpty')}
                    />
                </div>
            </SettingGroupCard>
        </Wrap>
    )
}

/** 空占位：首次加载中保持子页高度，避免布局跳动（对齐 WebToolsSection 的 Placeholder 语义） */
const Placeholder = styled.div`
    min-height: 200px;
`
