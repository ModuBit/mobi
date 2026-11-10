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

import { ArchivedSessionsPage } from '@/features/layout/ArchivedSessionsPage'

/**
 * 已归档会话设置分区（/settings/archived）：归档入口收编进设置页后的分区路由组件。
 * 放 pages/（不放 features/settings）——features 域间互引禁止（settings 引 layout
 * 违规），pages 引任何 features 合法。Listy 满高内滚由分区声明 layout:'fill'
 * （registry 单一真相）驱动，SettingsPage 响应式让出滚动链。
 */
export function SettingsArchivedSection() {
    return <ArchivedSessionsPage />
}
