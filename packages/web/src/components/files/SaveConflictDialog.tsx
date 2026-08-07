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

import { Drawer, Button } from 'antd'
import { useTranslation } from 'react-i18next'

interface Props {
    open: boolean
    onReload: () => void
    onForceOverwrite: () => void
}

/**
 * OCC 冲突 Drawer：保存返回 409（文件已被 Claude 改）时弹出。
 * 二选一：丢弃本地编辑重新加载 / 强制覆盖。
 *
 * 移动端底部 Drawer 规范：height:auto / maxHeight:85vh / 底部 safe-area（web CLAUDE.md）。
 */
export function SaveConflictDialog({ open, onReload, onForceOverwrite }: Props) {
    const { t } = useTranslation()
    return (
        <Drawer
            open={open}
            placement="bottom"
            closable={false}
            maskClosable={false}
            styles={{
                wrapper: { height: 'auto', maxHeight: '85vh' },
                body: { paddingBottom: 'max(24px, env(safe-area-inset-bottom))' },
            }}
        >
            <p style={{ margin: 0 }}>
                {t('files.conflictTip', '文件已被 Claude 修改，如何处理你的本地编辑？')}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <Button block onClick={onReload}>
                    {t('files.reload', '丢弃本地并重新加载')}
                </Button>
                <Button block danger onClick={onForceOverwrite}>
                    {t('files.forceOverwrite', '强制覆盖')}
                </Button>
            </div>
        </Drawer>
    )
}
