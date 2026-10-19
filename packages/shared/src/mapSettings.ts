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
 * 地图设置（settings.daemon.json 的 map 块）——高德两种 key 类型分开存：
 *
 * - `jsApiKey` + `securityJsCode`：Web 端（JS API）key 与安全密钥，交互地图用；
 *   两者缺一不可（2021-12-02 后申请的 key 强制配安全密钥）。安全密钥在明文
 *   模式下会下发给已登录的 Web 端——个人本地部署可接受，公开部署应改用官方
 *   推荐的服务端代理（`_AMapService`）。
 * - `webServiceKey`：Web 服务 API key，**只留在服务端**，静态地图代理用它拉图，
 *   永不下发给浏览器。
 *
 * 三档模式由配置推导（deriveMapMode），组件签名不变。
 */

import { z } from 'zod'

export const MapSettingsSchema = z.object({
    jsApiKey: z.string().trim().optional(),
    securityJsCode: z.string().trim().optional(),
    webServiceKey: z.string().trim().optional(),
})
export type MapSettings = z.infer<typeof MapSettingsSchema>

/** 提交方向（web → daemon）：空串 = 清除该字段，不在场 = 保持旧值 */
export const MapSettingsSubmissionSchema = z.object({
    jsApiKey: z.string().optional(),
    securityJsCode: z.string().optional(),
    webServiceKey: z.string().optional(),
})
export type MapSettingsSubmission = z.infer<typeof MapSettingsSubmissionSchema>

export type MapMode = 'interactive' | 'static' | 'none'

/** 配置 → 渲染档位：JS API key + 安全密钥齐备走交互，否则有服务端 key 走静态 */
export function deriveMapMode(settings: MapSettings | undefined): MapMode {
    if (settings?.jsApiKey?.trim() && settings.securityJsCode?.trim()) return 'interactive'
    if (settings?.webServiceKey?.trim()) return 'static'
    return 'none'
}

/**
 * 回显方向：JS API key 与安全密钥需要下发给前端（交互地图初始化），
 * Web 服务 key 只回「设没设」标记（它永远不离开 daemon）。
 */
export interface MapSettingsView {
    mode: MapMode
    jsApiKey?: string
    securityJsCode?: string
    webServiceKeySet: boolean
}

export function toMapSettingsView(settings: MapSettings | undefined): MapSettingsView {
    return {
        mode: deriveMapMode(settings),
        jsApiKey: settings?.jsApiKey?.trim() || undefined,
        securityJsCode: settings?.securityJsCode?.trim() || undefined,
        webServiceKeySet: Boolean(settings?.webServiceKey?.trim()),
    }
}

/** 锁内合并写（纯函数）：空串清除、不在场保持 */
export function mergeMapSettings(
    current: MapSettings | undefined,
    submission: MapSettingsSubmission,
): MapSettings {
    const next: MapSettings = { ...current }
    const apply = (key: keyof MapSettings): void => {
        const value = submission[key]
        if (value === undefined) return
        const trimmed = value.trim()
        if (trimmed) next[key] = trimmed
        else delete next[key]
    }
    apply('jsApiKey')
    apply('securityJsCode')
    apply('webServiceKey')
    return next
}
