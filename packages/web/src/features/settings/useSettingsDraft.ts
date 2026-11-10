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

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { App } from 'antd'
import { useTranslation } from 'react-i18next'

/**
 * 设置草稿模块（deep hook）——「草稿—基线—落盘」纪律的唯一承载（详见 web/CONTEXT.md「设置草稿」）。
 *
 * 分区只声明：字段投影（from）、提交内容构造（buildPayload，分区不变式所在）、落盘函数（save）。
 * 模块拥有全部纪律：加载后投影一次（invalidate 重读不重置编辑中草稿）、提交前规范化显示、
 * 失败统一呈现（默认 toast，inline 状态分区覆写 reportError）、成功后基线推进与字段副作用（onSaved）。
 *
 * 提交入口统一走 commit(key, patch)：blur 字段由 bindInput 在失焦/回车时以自身 key 提交；
 * 动作字段（开关/选择）由分区以语义 key + patchDraft 提交；batch 分区（如地图）以无 key
 * 形式整组提交、以约定 key（如 'clear'）表达清除类语义动作——buildPayload 拿 full draft
 * 与基线，对提交内容有最终决定权（enabledPending 特判这类跨字段不变式因此留在分区）。
 */

/** 单字段声明：初值投影 + 可选的编辑副作用、显示规范化与成功后副作用 */
export interface SettingsDraftField<V, S> {
    /** 加载完成后草稿与基线的初值投影（settings 未加载/缺失时也以 undefined 调用给出兜底初值） */
    from: (settings: S | undefined) => V
    /** 编辑副作用（与 onSaved 对称；如「编辑即清上次的连接检查结果」），bindInput 的 onChange 内触发 */
    onEdit?: () => void
    /** 失焦提交时对草稿做显示规范化（如刷新间隔整数化），规范化值写回草稿后再进 buildPayload */
    normalize?: (value: V) => V
    /** 提交成功且本字段在提交 payload 中时的副作用；reset 同时重置该字段草稿与基线（如密钥写后清空输入框） */
    onSaved?: (helpers: { reset: (value: V) => void }) => void
}

export interface UseSettingsDraftOptions<Draft extends Record<string, unknown>, S> {
    /** 加载完成标志：true 后投影一次初值 */
    loaded: boolean
    /** 设置数据源（投影入参；invalidate 重读不重置草稿） */
    settings: S | undefined
    /** 字段声明（key → 定义） */
    fields: { [K in keyof Draft]: SettingsDraftField<Draft[K], S> }
    /**
     * 提交内容构造（分区不变式所在）。key 为触发提交的字段（batch 为 ''，约定语义动作传自定义 key）；
     * 返回 null = 无需落盘；{ error } = 字段级校验失败（走 reportError，草稿保持让用户改）；
     * 返回 patch（可为跨字段 payload）= 落盘。对提交内容有最终决定权。
     */
    buildPayload: (key: string, draft: Draft, baseline: Draft) => Partial<Draft> | Record<string, unknown> | null | { error: string }
    /** 落盘函数（分区查询 hook 的 save） */
    save: (patch: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; error: string }>
    /** 失败呈现策略覆写：默认 message.error(error || fallback)；inline 状态分区（如地图）覆写 */
    reportError?: (error: string, fallback: string) => void
    /** 提交成功呈现（默认无；inline 状态分区覆写） */
    onCommitSuccess?: () => void
    /** 失败兜底文案 i18n key（如 settings.memory.saveFailed） */
    errorFallbackKey: string
}

export interface SettingsDraftApi<Draft extends Record<string, unknown>> {
    /** 草稿（渲染用；可变输入——最小标识外状态） */
    draft: Draft
    /** 纯编辑（onChange 接线；不触发提交） */
    setDraft: (patch: Partial<Draft>) => void
    /**
     * 提交。blur 字段：bindInput 自动以字段 key 调用；动作字段：分区以语义 key + patchDraft 调用
     * （patch 同步并入草稿，规避 setState 异步读到旧值）；batch：key 传 ''（或约定语义 key）。
     * 返回是否成功（payload 为 null 视为无事可做，返回 true）。
     */
    commit: (key?: string, patch?: Partial<Draft>) => Promise<boolean>
    /** input 类字段四件套接线（value/onChange/onBlur/onPressEnter），失焦与回车即以字段 key 提交 */
    bindInput: <K extends Extract<keyof Draft, string>>(key: K) => {
        value: Draft[K]
        onChange: (event: ChangeEvent<{ value: unknown }>) => void
        onBlur: () => void
        onPressEnter: () => void
    }
    /** 是否有字段草稿偏离基线（信号性暴露，分区可用可不闭环——现有分区不做门控） */
    dirty: boolean
}

/** 提交 payload 中出现的字段 key 集合（payload 均为平面对象） */
function payloadKeys(payload: Record<string, unknown> | null | { error: string }): string[] {
    if (!payload || 'error' in payload) return []
    return Object.keys(payload)
}

/**
 * 设置草稿 hook。泛型：Draft = 字段草稿形状，S = 设置数据形状。
 * 基线不驱动渲染（唯一渲染期用途是 dirty 信号），故为纯 ref；草稿为 state（驱动受控输入）。
 * commit/bindInput 不做 memoization：options 全是分区渲染期字面量，任何依赖收窄都是假稳定——
 * 低频交互页按渲染闭包执行即为正确语义。
 */
export function useSettingsDraft<Draft extends Record<string, unknown>, S>(
    options: UseSettingsDraftOptions<Draft, S>,
): SettingsDraftApi<Draft> {
    const { loaded, settings, fields, buildPayload, save, reportError, onCommitSuccess, errorFallbackKey } = options
    const { message } = App.useApp()
    const { t } = useTranslation()

    // 草稿：初值由 from(undefined) 给出（加载前兜底），loaded 后投影一次
    const [draft, setDraftState] = useState<Draft>(() => projectFrom(fields, undefined))
    const baselineRef = useRef<Draft>(projectFrom(fields, undefined))
    const [initialized, setInitialized] = useState(false)
    useEffect(() => {
        if (!loaded || initialized) return
        const projected = projectFrom(fields, settings)
        setDraftState(projected)
        baselineRef.current = projected
        setInitialized(true)
        // 纪律：invalidate 重读不重置编辑中草稿——只投影一次，settings 变化不再回写
    }, [loaded, initialized])

    // commit 的 async 续体内读最新草稿用 ref，规避闭包旧值
    const draftRef = useRef(draft)
    draftRef.current = draft

    const reportFailure = reportError ?? ((error: string, fallback: string) => { message.error(error || fallback) })

    const commit = async (key = '', patch?: Partial<Draft>): Promise<boolean> => {
        // 合并 patch 后按字段声明做显示规范化（规范化值写回草稿，对齐既有「失焦整数化」行为）
        let nextDraft: Draft = { ...draftRef.current, ...(patch ?? {}) }
        const normalizer = key ? fields[key]?.normalize : undefined
        if (key && normalizer) {
            // 运行时 key 恒为已声明字段（分区以语义 key 调用），跨字段泛型在编译期收不拢，此处置断言
            nextDraft = { ...nextDraft, [key]: (normalizer as (v: unknown) => Draft[string])(nextDraft[key]) }
        }
        setDraftState(nextDraft)
        draftRef.current = nextDraft

        const payload = buildPayload(key, nextDraft, baselineRef.current)
        if (payload === null) return true
        if ('error' in payload) {
            // narrowing 后 Record<string, unknown> 分支的 error 仍是 unknown——这里是判别 union 的 error 档
            reportFailure((payload as { error: string }).error, t(errorFallbackKey))
            return false
        }
        const result = await save(payload)
        if (!result.ok) {
            reportFailure(result.error, t(errorFallbackKey))
            return false
        }
        // 基线推进：payload 中出现且为已声明字段的 key，基线 := 提交时的草稿值
        const committedKeys = new Set(payloadKeys(payload).filter((k) => k in fields))
        const nextBaseline = { ...baselineRef.current }
        for (const k of committedKeys) nextBaseline[k as keyof Draft] = nextDraft[k as keyof Draft]
        baselineRef.current = nextBaseline
        // 字段副作用：触发集合 = 提交 key ∪ payload 中的字段 key（写后清空等——
        // payload key 与草稿字段不同名时（如 headers→headersDraft）由提交 key 兜底触发）
        const savedFieldKeys = new Set(committedKeys)
        if (key && key in fields) savedFieldKeys.add(key)
        for (const k of savedFieldKeys) {
            const field = fields[k as keyof Draft]
            field?.onSaved?.({
                reset: (value) => {
                    const cleared = { ...baselineRef.current, [k]: value }
                    baselineRef.current = cleared
                    const clearedDraft = { ...draftRef.current, [k]: value }
                    draftRef.current = clearedDraft
                    setDraftState(clearedDraft)
                },
            })
        }
        onCommitSuccess?.()
        return true
    }

    const setDraft = (patch: Partial<Draft>) => {
        setDraftState((prev) => ({ ...prev, ...patch }))
    }

    const bindInput = <K extends Extract<keyof Draft, string>>(key: K) => ({
        value: draft[key],
        onChange: (event: ChangeEvent<{ value: unknown }>) => {
            setDraftState((prev) => ({ ...prev, [key]: event.target.value as Draft[K] }))
            fields[key].onEdit?.()
        },
        onBlur: () => { void commit(key) },
        onPressEnter: () => { void commit(key) },
    })

    const dirty = (Object.keys(fields) as (keyof Draft & string)[])
        .some((k) => draft[k] !== baselineRef.current[k])

    return { draft, setDraft, commit, bindInput, dirty }
}

/** 按字段声明投影一份草稿/基线快照 */
function projectFrom<Draft extends Record<string, unknown>, S>(
    fields: { [K in keyof Draft]: SettingsDraftField<Draft[K], S> },
    settings: S | undefined,
): Draft {
    const result = {} as Draft
    for (const k of Object.keys(fields) as (keyof Draft & string)[]) {
        result[k] = fields[k].from(settings)
    }
    return result
}
