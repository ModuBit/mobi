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

import { SETTINGS_SECTIONS, type SettingsSection } from './registry'

const STORAGE_KEY = 'settings.lastSection'

/** 「记住上次分区」的缺省：无记录/脏数据时的落点（PC index 重定向与 404 兜底共用，勿再散写字面量） */
export const DEFAULT_SETTINGS_SECTION: SettingsSection['id'] = 'notifications'

/**
 * 上次访问分区的持久化存取（「记住上次分区」）。
 * 读侧校验：id 必须是已知分区且当前可见（debug 解锁后写入的 debug，锁定后读回 null），
 * 脏数据/损坏内容一律回落 null，不被 localStorage 击穿。
 * 深链语义由消费方处理：深链直达时以 URL 为准并经 write 更新记录。
 */
export function readLastSettingsSection(): SettingsSection['id'] | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const id = JSON.parse(raw) as SettingsSection['id']
        const section = SETTINGS_SECTIONS.find((s) => s.id === id)
        return section && section.visible() ? id : null
    } catch {
        return null
    }
}

export function writeLastSettingsSection(id: SettingsSection['id']): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(id))
    } catch {
        // 隐私模式等写入失败静默：该记录只是体验优化，失败不影响功能
    }
}
