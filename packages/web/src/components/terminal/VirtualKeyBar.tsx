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
import { Settings } from 'lucide-react'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import { useVirtualKeysStore } from '@/core/data/stores/virtualKeysStore'

/**
 * 横向滚动的虚拟按键条（移动端专用）。
 * 移动端无物理键盘，常用控制键/组合键/方向键无法触发；此处提供快捷按钮，
 * 点击直接发送字节到 PTY。末尾齿轮进入自定义编辑（增删改排序，存 localStorage）。
 */
const Bar = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    /* 底部安全边界：避开手机底部横条/圆角 */
    padding-bottom: max(6px, env(safe-area-inset-bottom));
    overflow-x: auto;
    overflow-y: hidden;
    border-top: 1px solid var(--ant-color-border-secondary);
    background: var(--ant-color-bg-layout);
    -webkit-overflow-scrolling: touch;
    /* 隐藏滚动条（保留可滑动） */
    scrollbar-width: none;
    &::-webkit-scrollbar {
        display: none;
    }
`

const KeyBtn = styled(Button)`
    flex-shrink: 0;
    min-width: 40px;
    font-family: var(--ant-font-family-code);
`

interface VirtualKeyBarProps {
    /** 发送字节序列到终端 */
    onSend: (data: string) => void
    /** 打开自定义编辑 Drawer */
    onEdit: () => void
}

export function VirtualKeyBar({ onSend, onEdit }: VirtualKeyBarProps) {
    const { t } = useTranslation()
    const keys = useVirtualKeysStore((s) => s.keys)

    return (
        <Bar role="toolbar" aria-label={t('terminal.virtualKeys.aria')}>
            {keys.map((k) => (
                <KeyBtn key={k.id} size="small" onClick={() => onSend(k.data)}>
                    {k.label}
                </KeyBtn>
            ))}
            <KeyBtn
                size="small"
                type="text"
                icon={<Settings size={16} />}
                onClick={onEdit}
                aria-label={t('terminal.virtualKeys.edit')}
            />
        </Bar>
    )
}
