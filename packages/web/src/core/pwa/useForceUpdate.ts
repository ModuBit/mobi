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

import { useCallback } from 'react'
import { Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import { forceUpdateAndReload } from './forceUpdate'

/**
 * 「重启」点击 handler:弹 Modal.confirm 二次确认后执行强制刷新。
 *
 * 为何要二次确认:硬刷新会中断页面。composerDrafts(文本+已上传附件,存 sessionStorage,
 * reload 不丢)不受影响,但正在上传中的附件、未落盘的内存状态会丢。
 *
 * loading 态由 Modal.confirm 的 onOk 返回 Promise 自动承载(okButton 自动 loading)。
 * Modal.confirm 为命令式 API,故 hook 只返回 onClick,无额外 state。
 */
export function useForceUpdate(): () => void {
    const { t } = useTranslation()
    return useCallback(() => {
        Modal.confirm({
            title: t('notification.pwa.forceRefreshTitle'),
            content: t('notification.pwa.forceRefreshContent'),
            okText: t('notification.pwa.forceRefreshOk'),
            cancelText: t('common.cancel'),
            okButtonProps: { danger: true },
            okCancel: true,
            onOk: () => forceUpdateAndReload(),
        })
    }, [t])
}
