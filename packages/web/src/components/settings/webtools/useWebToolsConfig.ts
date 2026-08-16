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

import { useState, useEffect, useCallback } from 'react'
import { useMobiApi } from '@/core/data/api/client'
import type { RedactedWebToolsConfig, WebToolsConfigSubmission } from '@mobi/shared'

export interface WebToolsState {
    machineId: string | null
    config: RedactedWebToolsConfig | null
    offline: boolean
    loadError: string | null
    loaded: boolean
    reload: () => void
    saving: boolean
    /** 提交（在场性）：凭据键只在用户编辑时才进 payload；失败返回 false（提示由调用方） */
    save: (config: WebToolsConfigSubmission) => Promise<boolean>
}

/**
 * Web 工具子页数据 hook：两跳加载（机器列表第一台在线 → 脱敏配置）+ 提交。
 * offline = 502/网络异常/无在线机器；loadError = runner 读盘失败（error envelope）——两者分开。
 * 保存成功后由调用方触发 reload() 重读脱敏配置（hook 不自动，避免掩盖提交结果）。
 */
export function useWebToolsConfig(): WebToolsState {
    const api = useMobiApi()
    const [machineId, setMachineId] = useState<string | null>(null)
    const [config, setConfig] = useState<RedactedWebToolsConfig | null>(null)
    const [offline, setOffline] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [loaded, setLoaded] = useState(false)
    const [saving, setSaving] = useState(false)
    /** 重拉计数：reload 复位全部状态后 bump 触发 effect 重跑 */
    const [nonce, setNonce] = useState(0)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                // 两跳串行：机器列表（取第一台在线）→ 该机器的脱敏配置
                const machinesRes = await api.machines.list()
                const online = machinesRes.data.machines.find((m) => m.active)
                if (!online) {
                    // 无在线机器：正常业务态（目标机器未连接），按离线呈现但不 warn
                    if (cancelled) return
                    setOffline(true)
                    setLoaded(true)
                    return
                }
                const configRes = await api.machines.webTools.get(online.id)
                if (cancelled) return
                // runner 读盘失败返回 error envelope（区别于机器离线），单独提示不吞进 offline 分支
                if (!('config' in configRes.data)) {
                    setLoadError(configRes.data.error ?? '')
                    setLoaded(true)
                    return
                }
                setMachineId(online.id)
                setConfig(configRes.data.config)
                setLoaded(true)
            } catch (error) {
                // 502（runner 离线）/ 网络异常，统一按"机器离线"提示；
                // warn 保留现场（先观测原则），编程错误不被静默吞掉
                console.warn('[useWebToolsConfig] 加载失败', error)
                if (!cancelled) {
                    setOffline(true)
                    setLoaded(true)
                }
            }
        })()
        return () => {
            cancelled = true
        }
    }, [api, nonce])

    const reload = useCallback(() => {
        setOffline(false)
        setLoadError(null)
        setLoaded(false)
        setConfig(null)
        setMachineId(null)
        setNonce((n) => n + 1)
    }, [])

    const save = useCallback(
        async (config: WebToolsConfigSubmission) => {
            if (!machineId) return false
            setSaving(true)
            try {
                const { data } = await api.machines.webTools.set(machineId, config)
                return data?.success === true
            } catch {
                // 502（runner 离线）等传输层异常，交由调用方统一提示
                return false
            } finally {
                setSaving(false)
            }
        },
        [api, machineId],
    )

    return { machineId, config, offline, loadError, loaded, reload, saving, save }
}
