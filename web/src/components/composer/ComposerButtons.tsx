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

import { Button, Tooltip, theme } from 'antd'
import {
    SendOutlined,
    LoadingOutlined,
    StopOutlined,
    PaperClipOutlined,
    SettingOutlined,
    ReloadOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

interface ComposerButtonsProps {
    /** 是否可以发送 */
    canSend: boolean
    /** 是否禁用控制 */
    controlsDisabled: boolean
    /** 是否正在发送 */
    isSending: boolean
    /** 是否正在思考 */
    isThinking: boolean
    /** 是否显示设置按钮 */
    showSettingsButton: boolean
    /** 设置按钮点击回调 */
    onSettingsToggle: () => void
    /** 附件按钮点击回调 */
    onAttach: () => void
    /** 发送回调 */
    onSend: () => void
    /** 中断回调 */
    onAbort: () => void
}

/**
 * Composer 操作按钮组件
 */
export function ComposerButtons(props: ComposerButtonsProps) {
    const {
        canSend,
        controlsDisabled,
        isSending,
        isThinking,
        showSettingsButton,
        onSettingsToggle,
        onAttach,
        onSend,
        onAbort
    } = props
    const { t } = useTranslation()
    const { token } = theme.useToken()

    // 发送按钮状态
    const sendDisabled = controlsDisabled || !canSend || isSending

    // 附件按钮状态
    const attachDisabled = controlsDisabled

    // 中断按钮状态
    const showAbortButton = isThinking || isSending
    const abortDisabled = controlsDisabled

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px 8px'
        }}>
            {/* 左侧按钮组 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {/* 附件按钮 */}
                <Tooltip title={t('composer.attach')}>
                    <Button
                        type="text"
                        size="small"
                        icon={<PaperClipOutlined />}
                        onClick={onAttach}
                        disabled={attachDisabled}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            color: attachDisabled
                                ? token.colorTextDisabled
                                : token.colorTextSecondary
                        }}
                    />
                </Tooltip>

                {/* 设置按钮 */}
                {showSettingsButton && (
                    <Tooltip title={t('composer.settings')}>
                        <Button
                            type="text"
                            size="small"
                            icon={<SettingOutlined />}
                            onClick={onSettingsToggle}
                            disabled={controlsDisabled}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 32,
                                height: 32,
                                borderRadius: '50%',
                                color: controlsDisabled
                                    ? token.colorTextDisabled
                                    : token.colorTextSecondary
                            }}
                        />
                    </Tooltip>
                )}

                {/* 中断按钮 */}
                {showAbortButton && (
                    <Tooltip title={t('composer.abort')}>
                        <Button
                            type="text"
                            size="small"
                            icon={<StopOutlined />}
                            onClick={onAbort}
                            disabled={abortDisabled}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 32,
                                height: 32,
                                borderRadius: '50%',
                                color: token.colorError
                            }}
                        />
                    </Tooltip>
                )}
            </div>

            {/* 右侧发送按钮 */}
            <Button
                type="primary"
                shape="circle"
                size="small"
                icon={isSending ? <LoadingOutlined /> : <SendOutlined />}
                onClick={onSend}
                disabled={sendDisabled}
                style={{
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            />
        </div>
    )
}
