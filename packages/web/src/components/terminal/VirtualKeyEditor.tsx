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

import { useEffect, useState } from 'react'
import { Drawer, Button, Space, Typography, Tag } from 'antd'
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVirtualKeysStore, type VirtualKey } from '@/core/data/stores/virtualKeysStore'
import { VirtualKeyPicker } from './VirtualKeyPicker'

interface VirtualKeyEditorProps {
    open: boolean
    onClose: () => void
}

/**
 * 虚拟按键自定义 Drawer：删除、上下排序；添加经 Picker 选择（组合修饰+主键，非手填转义）。
 * 打开时从 store 初始化本地副本，保存时整体 setKeys。
 */
export function VirtualKeyEditor({ open, onClose }: VirtualKeyEditorProps) {
    const { t } = useTranslation()
    const setKeys = useVirtualKeysStore((s) => s.setKeys)
    const stored = useVirtualKeysStore((s) => s.keys)
    const [items, setItems] = useState<VirtualKey[]>([])
    const [pickerOpen, setPickerOpen] = useState(false)

    useEffect(() => {
        if (open) {
            setItems(stored.map((k) => ({ ...k })))
        }
    }, [open, stored])

    const remove = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id))
    const move = (idx: number, dir: -1 | 1) =>
        setItems((prev) => {
            const j = idx + dir
            if (j < 0 || j >= prev.length) return prev
            const next = [...prev]
            ;[next[idx], next[j]] = [next[j], next[idx]]
            return next
        })
    const addKey = (key: VirtualKey) => setItems((prev) => [...prev, key])

    const save = () => {
        setKeys(items)
        onClose()
    }

    return (
        <Drawer
            title={t('terminal.virtualKeys.editor.title')}
            open={open}
            onClose={save}
            placement="bottom"
            height="auto"
            styles={{
                wrapper: { height: 'auto', maxHeight: '85dvh' },
                body: { paddingBottom: 'max(24px, env(safe-area-inset-bottom))' },
            }}
            extra={
                <Button type="primary" onClick={save}>
                    {t('terminal.virtualKeys.editor.save')}
                </Button>
            }
        >
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {items.map((it, idx) => (
                    <Space key={it.id} style={{ width: '100%', justifyContent: 'space-between' }} align="center">
                        <Tag style={{ fontFamily: 'var(--ant-font-family-code)' }}>{it.label}</Tag>
                        <Space size={2}>
                            <Button
                                size="small"
                                type="text"
                                icon={<ChevronUp size={14} />}
                                disabled={idx === 0}
                                onClick={() => move(idx, -1)}
                            />
                            <Button
                                size="small"
                                type="text"
                                icon={<ChevronDown size={14} />}
                                disabled={idx === items.length - 1}
                                onClick={() => move(idx, 1)}
                            />
                            <Button
                                size="small"
                                type="text"
                                danger
                                icon={<Trash2 size={14} />}
                                onClick={() => remove(it.id)}
                            />
                        </Space>
                    </Space>
                ))}
                <Button icon={<Plus size={14} />} onClick={() => setPickerOpen(true)} block>
                    {t('terminal.virtualKeys.editor.add')}
                </Button>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('terminal.virtualKeys.editor.hint')}
                </Typography.Text>
            </Space>

            <VirtualKeyPicker
                open={pickerOpen}
                onAdd={addKey}
                onClose={() => setPickerOpen(false)}
            />
        </Drawer>
    )
}
