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

import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { WorktreeState } from '@mobi/shared'

const STATE_COLOR: Record<WorktreeState, string> = {
    clean: 'success',
    dirty: 'warning',
    unknown: 'default',
    running: 'processing'
}

/** worktree 状态徽标（clean / dirty / unknown / running）：会话吊顶与设置页共用 */
export function WorktreeStateTag({ state }: { state: WorktreeState }) {
    const { t } = useTranslation()
    return (
        <Tag color={STATE_COLOR[state]} style={{ marginInlineEnd: 0 }}>
            {t(`settings.worktrees.state.${state}`)}
        </Tag>
    )
}
