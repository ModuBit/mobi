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

import { Button, Space, Spin } from 'antd'

export interface ActionButtonsProps {
    isPending: boolean
    canCreate: boolean
    isDisabled: boolean
    createLabel?: string
    onCancel: () => void
    onCreate: () => void
}

/**
 * 操作按钮组件
 */
export function ActionButtons({
    isPending,
    canCreate,
    isDisabled,
    createLabel,
    onCancel,
    onCreate
}: ActionButtonsProps) {
    return (
        <div className="flex gap-2 px-3 py-3">
            <Space>
                <Button
                    onClick={onCancel}
                    disabled={isDisabled}
                >
                    取消
                </Button>
                <Button
                    type="primary"
                    onClick={onCreate}
                    disabled={!canCreate}
                    icon={isPending ? <Spin size="small" /> : null}
                >
                    {isPending ? '创建中...' : (createLabel ?? '创建会话')}
                </Button>
            </Space>
        </div>
    )
}
