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
 * 用户气泡的 UI 来源标记（generative-ui 票 06 安全缓解之一）：经 openui 块 / 沙箱
 * app bridge 发出的消息在气泡 header 弱化标注来源——app 内脚本冒充用户发消息是
 * bridge 的已知残余风险面（ADR 0007 增补），用户能一眼分辨「这条不是我手打的」
 * 是兜底辨识手段。手打（缺省）与 CLI 回显不标。
 */

import { theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { MousePointerClick, AppWindow } from 'lucide-react'
import { isUiMessageOrigin, type UiMessageOrigin } from '@mobi/shared'

/**
 * 来源 → 展示元数据的唯一映射：Record 保证 exhaustive——shared 加一个 UI 回灌来源
 * 而漏配此处，类型层即红（不会静默不显示）。图标/文案是 web 展示概念，留在 web。
 */
const ORIGIN_META: Record<UiMessageOrigin, { labelKey: string; Icon: typeof MousePointerClick }> = {
    openui: { labelKey: 'chat.origin.openui', Icon: MousePointerClick },
    app: { labelKey: 'chat.origin.app', Icon: AppWindow },
}

/** 弱化来源 chip：与 user-msg-terminal 同呈现档（小号 + 三级前景色，可辨识不抢焦） */
export function SentFromTag({ sentFrom }: { sentFrom: string | null | undefined }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    if (!isUiMessageOrigin(sentFrom)) return null
    const { labelKey, Icon } = ORIGIN_META[sentFrom]
    return (
        <span
            data-testid="user-msg-origin"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: token.colorTextTertiary, fontSize: 11 }}
        >
            <Icon size={12} />
            {t(labelKey)}
        </span>
    )
}
