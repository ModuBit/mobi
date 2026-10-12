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

import { useState } from 'react'
import { Modal, Button, Space, Typography } from 'antd'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import {
    MODIFIERS,
    MAIN_KEY_GROUPS,
    buildKeySequence,
    type Modifier,
} from './keySequence'
import type { VirtualKey } from '@/core/data/stores/virtualKeysStore'

const KeyGrid = styled.div`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
    gap: 6px;
`

const GroupTitle = styled(Typography.Text)`
    font-size: 12px;
`

interface VirtualKeyPickerProps {
    open: boolean
    onAdd: (key: VirtualKey) => void
    onClose: () => void
}

/**
 * 按键选择器：先选修饰键（Ctrl/Alt/Shift，可组合），再选主键，
 * 实时预览 label 并校验组合是否可生成。确认后回传 VirtualKey。
 * 替代手填转义序列——用户无需了解 \x03 等转义。
 */
export function VirtualKeyPicker({ open, onAdd, onClose }: VirtualKeyPickerProps) {
    const { t } = useTranslation()
    const [mods, setMods] = useState<Modifier[]>([])
    const [keyId, setKeyId] = useState<string | null>(null)

    const built = keyId ? buildKeySequence(mods, keyId) : null

    const toggleMod = (m: Modifier) =>
        setMods((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
    const reset = () => {
        setMods([])
        setKeyId(null)
    }
    const handleAdd = () => {
        if (!built) return
        onAdd({ id: `key-${Date.now()}`, label: built.label, data: built.data })
        reset()
    }
    const handleClose = () => {
        reset()
        onClose()
    }

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            title={t('terminal.virtualKeys.picker.title')}
            footer={[
                <Button key="cancel" onClick={handleClose}>
                    {t('terminal.virtualKeys.picker.cancel')}
                </Button>,
                <Button key="add" type="primary" disabled={!built} onClick={handleAdd}>
                    {t('terminal.virtualKeys.picker.add')}
                </Button>,
            ]}
        >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {/* 修饰键（多选 toggle） */}
                <Space>
                    {MODIFIERS.map((m) => (
                        <Button
                            key={m.id}
                            type={mods.includes(m.id) ? 'primary' : 'default'}
                            onClick={() => toggleMod(m.id)}
                        >
                            {m.label}
                        </Button>
                    ))}
                </Space>
                {/* 主键分组 */}
                {MAIN_KEY_GROUPS.map((g) => (
                    <div key={g.title}>
                        <GroupTitle type="secondary">{g.title}</GroupTitle>
                        <KeyGrid style={{ marginTop: 4 }}>
                            {g.keys.map((k) => {
                                const supported = buildKeySequence(mods, k.id) !== null
                                const selected = keyId === k.id
                                return (
                                    <Button
                                        key={k.id}
                                        size="small"
                                        disabled={!supported}
                                        type={selected ? 'primary' : 'default'}
                                        style={{ fontFamily: 'var(--ant-font-family-code)' }}
                                        onClick={() => setKeyId(k.id)}
                                    >
                                        {k.label}
                                    </Button>
                                )
                            })}
                        </KeyGrid>
                    </div>
                ))}
                {built && (
                    <Typography.Text>
                        {t('terminal.virtualKeys.picker.preview')} <strong>{built.label}</strong>
                    </Typography.Text>
                )}
            </Space>
        </Modal>
    )
}
