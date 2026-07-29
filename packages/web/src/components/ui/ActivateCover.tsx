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

import { Button } from 'antd'
import { PlayCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ActivateCoverProps {
    /** 点击「恢复/激活」回调 */
    onActivate: () => void
    /** 恢复请求进行中 */
    loading?: boolean
    /** 按钮文案的 i18n key，默认 composer.activate */
    labelKey?: string
    /** 覆盖层 zIndex，默认 10 */
    zIndex?: number
    /** 覆盖层圆角，默认 0 */
    borderRadius?: string | number
    /** 透传 className（磨砂遮罩：InspectorPane 铺彩色内容用 sender-overlay；
     *  ChatComposer 铺实色 Sender 用 composer-cover-mask，白底可见） */
    className?: string
}

/**
 * 会话未激活（CLI runner 未连接）时的覆盖层：铺满父容器、居中「恢复会话」按钮。
 * 聊天输入框与检视面板共用，避免两处各自维护样式/loading/文案。
 * 父容器需 position: relative。
 */
export function ActivateCover({
    onActivate,
    loading = false,
    labelKey = 'composer.activate',
    zIndex = 10,
    borderRadius = 0,
    className,
}: ActivateCoverProps) {
    const { t } = useTranslation()
    return (
        <div
            className={className}
            style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius,
                zIndex,
            }}
        >
            <Button type="primary" icon={<PlayCircle size={18} />} loading={loading} onClick={onActivate}>
                {t(labelKey)}
            </Button>
        </div>
    )
}
