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
 * 会话删除时「worktree 已保留」提示（桌面侧栏与移动端 ActionSheet 共用）：
 * 脏 worktree 不会被静默销毁，提示里给出设置页处置入口。文案单源在此，
 * 两处删除调用点只负责传 notification/t/navigate。
 */

import { App } from 'antd'
import type { RetainedWorktree } from '@mobi/shared'
import { Button } from '@/ui/base/interactive/button/Button'

type NotificationApi = ReturnType<typeof App.useApp>['notification']
type Translate = (key: string, options?: Record<string, unknown>) => string

const NOTICE_KEY = 'session-retained-worktree'

export function notifyRetainedWorktree(options: {
    notification: NotificationApi
    t: Translate
    retained: RetainedWorktree
    onManage: () => void
}): void {
    const { notification, t, retained, onManage } = options
    notification.warning({
        key: NOTICE_KEY,
        message: t('settings.worktrees.retainedTitle'),
        description: t('settings.worktrees.retainedDesc', {
            name: retained.name,
            count: retained.dirtyFileCount
        }),
        duration: 8,
        btn: (
            <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                    notification.destroy(NOTICE_KEY)
                    onManage()
                }}
            >
                {t('settings.worktrees.goManage')}
            </Button>
        )
    })
}
