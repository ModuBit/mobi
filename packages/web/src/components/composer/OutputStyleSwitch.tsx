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
 * output style 切换器（ChatComposer 参数区，权限模式切换器旁）。
 *
 * 切换语义是 /clear（清空上下文），故运行中 / clear 进行中 / 提交 pending 均禁用；
 * 选中后先弹确认框说明清空后果，确认才调 mutation（CLI 重启 + init 回报经
 * session.metadata.sdkMetadata.outputStyle 回流刷新当前值）。
 */

import { useMemo } from 'react'
import { App, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useSwitchOutputStyle } from '@/core/data/hooks/mutations/useSwitchOutputStyle'
import { CompactHoverSelect } from './CompactHoverSelect'
import { buildOutputStyleSelectOptions, renderOutputStyleOption } from './outputStyleOption'

export interface OutputStyleSwitchProps {
    sessionId: string
    /** 当前 output style（session.metadata.sdkMetadata.outputStyle，init 回报；undefined → default） */
    outputStyle?: string | null
    /** 会话运行中：禁用切换（/clear 语义不可在运行中清空上下文） */
    running?: boolean
    /** /clear 进行中：禁用切换（同属清空上下文链路，避免并发冲突） */
    clearInProgress?: boolean
    /** 其余禁用原因（会话失活 / 本地模式覆盖等，调用方控件级禁用透传） */
    disabled?: boolean
}

export function OutputStyleSwitch({
    sessionId,
    outputStyle,
    running = false,
    clearInProgress = false,
    disabled = false,
}: OutputStyleSwitchProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const { modal } = App.useApp()
    const outputStyleMutation = useSwitchOutputStyle()
    const outputStyleOptions = useMemo(() => buildOutputStyleSelectOptions(), [])

    const currentOutputStyle = outputStyle ?? 'default'
    const switchDisabled = running || clearInProgress || disabled || outputStyleMutation.isPending

    const handleOutputStyleChange = (style: unknown) => {
        const value = String(style)
        const label = outputStyleOptions.find((o) => o.value === value)?.label ?? value
        modal.confirm({
            title: t('composer.outputStyleSwitchTitle'),
            content: t('composer.outputStyleSwitchConfirm', { label }),
            onOk: () => outputStyleMutation.mutate({ sessionId, style: value }),
        })
    }

    return (
        // 外层原生 title：idle 显示控件名，running 时改为「结束后可切换」提示
        //（与权限模式切换器一致的极简做法，无气泡组件）
        <span
            style={{ display: 'inline-flex' }}
            title={running ? t('composer.outputStyleRunningDisabled') : t('composer.outputStyle')}
        >
            <CompactHoverSelect
                $token={token}
                value={currentOutputStyle}
                options={outputStyleOptions}
                disabled={switchDisabled}
                loading={outputStyleMutation.isPending}
                onChange={handleOutputStyleChange}
                optionRender={(option) => renderOutputStyleOption(option, outputStyleOptions, t)}
                virtual={false}
            />
        </span>
    )
}
