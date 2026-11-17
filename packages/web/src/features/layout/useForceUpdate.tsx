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

import { useCallback, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/ui/base/interactive/button/Button'
import { AdaptiveDialog } from '@/ui/base/interactive/adaptiveDialog/AdaptiveDialog'
import { forceUpdateAndReload } from '@/core/pwa/forceUpdate'

/**
 * 「重启」动作流：请求二次确认（端别自适应对话框）→ 确认后强制刷新。
 *
 * 为何要二次确认：硬刷新会中断页面。composerDrafts（文本+已上传附件，存 sessionStorage，
 * reload 不丢）不受影响，但正在上传中的附件、未落盘的内存状态会丢。
 *
 * 返回 `{ restart, confirmNode }`：`restart` 触发确认，`confirmNode` 由调用方渲染——
 * 确认框走自管自适应壳（PC 居中 Dialog / 移动端底部 sheet），不再用 antd 命令式 API，
 * 也不从 core 层引 UI（hook 因此落在 features 层，core/pwa 只留纯逻辑）。
 */
export function useForceUpdate(): { restart: () => void; confirmNode: ReactNode } {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [reloading, setReloading] = useState(false)

    const restart = useCallback(() => setOpen(true), [])

    const confirmNode = (
        <AdaptiveDialog
            open={open}
            onOpenChange={(next) => { if (!next && !reloading) setOpen(false) }}
            title={t('notification.pwa.forceRefreshTitle')}
            width={440}
            body={<p style={{ margin: 0 }}>{t('notification.pwa.forceRefreshContent')}</p>}
            footer={(
                <>
                    <Button variant="secondary" disabled={reloading} onClick={() => setOpen(false)}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant="danger"
                        loading={reloading}
                        onClick={() => {
                            setReloading(true)
                            void forceUpdateAndReload()
                        }}
                    >
                        {t('notification.pwa.forceRefreshOk')}
                    </Button>
                </>
            )}
        />
    )

    return { restart, confirmNode }
}
