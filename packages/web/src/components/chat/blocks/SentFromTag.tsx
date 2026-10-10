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

/** 来源 → i18n key（仅 UI 回灌两值；其余 null 不标） */
export function sentFromTagLabelKey(sentFrom: string | null | undefined): string | null {
    if (sentFrom === 'openui') return 'chat.origin.openui'
    if (sentFrom === 'app') return 'chat.origin.app'
    return null
}

/** 弱化来源 chip：与 user-msg-terminal 同呈现档（小号 + 三级前景色，可辨识不抢焦） */
export function SentFromTag({ sentFrom }: { sentFrom: string | null | undefined }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const key = sentFromTagLabelKey(sentFrom)
    if (key === null) return null
    const Icon = sentFrom === 'app' ? AppWindow : MousePointerClick
    return (
        <span
            data-testid="user-msg-origin"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: token.colorTextTertiary, fontSize: 11 }}
        >
            <Icon size={12} />
            {t(key)}
        </span>
    )
}
