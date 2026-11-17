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

import { useTranslation } from 'react-i18next'
import { MobiLogo } from '@/ui/base/brand/MobiLogo'
import { Skeleton } from '@/ui/shadcn/skeleton/skeleton'

/**
 * 历史消息加载占位（首页历史仍在拉取、列表尚无任何内容时替换欢迎页）。
 *
 * 为什么是骨架而不是全屏 loader：首拉可能与 SSE 流式输出并发——全屏 loader 会把
 * 已经到达的流式内容整个盖住（且卸载 composer），用户只剩「转圈」可看；骨架行
 * 留在消息列表位置，表达「内容即将出现在这里」。
 */
export function ChatMessagesSkeleton() {
    const { t } = useTranslation()
    return (
        <div
            role="status"
            aria-label={t('chat.loadingHistory')}
            style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 760, margin: '0 auto' }}
        >
            {/* 骨架行自带 role="status"；外层统一播报一次，内层对读屏隐藏避免重复 */}
            <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                <Skeleton lines={2} avatar />
                <Skeleton lines={3} avatar />
                <Skeleton lines={2} avatar />
            </div>
        </div>
    )
}

/**
 * 列表顶部「更早历史仍在拉取」行——已有实时内容（SSE 先到）时用，
 * 视觉语言与 BubbleListChat 的「滚到顶加载」行一致（品牌动效即"正在拉取"）。
 */
export function HistoryLoadingRow() {
    const { t } = useTranslation()
    return (
        <div
            role="status"
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '8px 0' }}
        >
            <MobiLogo size={24} />
            <span style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('chat.loadingHistory')}</span>
        </div>
    )
}
