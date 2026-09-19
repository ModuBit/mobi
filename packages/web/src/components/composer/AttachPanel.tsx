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
 * 附加面板（composer「+」按钮的弹出菜单，Codex 风格富面板）：
 * 分组标题 + 图标 + 主文字 + 灰色说明文字的菜单项列表。聚合消息附件的所有入口——
 * 文件（PC）/ 文件或相册（移动端）/ 拍照录像（仅移动端）/ 画板，后续新增入口在此扩展。
 * 弹层经 antd Popover 承载（定位/外点关闭托管的都是它），菜单项为受控受样式的自绘内容。
 */

import { useState, type ReactNode } from 'react'
import { Button, Dropdown } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { Camera, Paperclip, PenLine } from 'lucide-react'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'

export interface AttachPanelProps {
    disabled?: boolean
    /** 打开系统选择器（file=文件；camera=移动端直开相机），由调用方 handleAttach 承接 */
    onAttach: (source: 'file' | 'camera') => void
    /** 打开画板；缺省不渲染画板项（新建页无画板入口） */
    onSketch?: () => void
}

/* 面板自带底色/边框/阴影：popupRender 自定义内容时 Dropdown 容器不带背景，须自持 */
const Panel = styled.div`
    width: 264px;
    padding: 6px;
    background: var(--ant-color-bg-elevated);
    border: 1px solid var(--ant-color-border);
    border-radius: 14px;
    box-shadow: var(--ant-box-shadow-secondary);
`

/* 分组标题：弱化但清晰可读（用户指定加大，不压到菜单项之下） */
const GroupTitle = styled.div`
    padding: 6px 10px 4px;
    font-size: 13px;
    color: var(--ant-color-text-secondary);
`

/* 菜单项：整行可点，hover 铺底；icon 左、主文字右（无说明文字，用户指定精简） */
const Item = styled.button`
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.2s;

    &:hover { background: var(--ant-color-fill-tertiary); }
    &:active { background: var(--ant-color-fill-secondary); }

    .icon { color: var(--ant-color-text-secondary); flex-shrink: 0; }

    .title { font-size: 14px; color: var(--ant-color-text); }
`

/** 面板单项（纯展示组装，供文件/拍照/画板共用） */
function PanelItem({ icon, title, onClick }: { icon: ReactNode; title: string; onClick: () => void }) {
    return (
        <Item type="button" onClick={onClick}>
            <span className="icon">{icon}</span>
            <span className="title">{title}</span>
        </Item>
    )
}

/**
 * 「+」按钮 + 附加面板：面板内容自绘（分组标题 + 富菜单项），承载用 antd Dropdown
 * （popupRender 自定义面板，语义即「菜单」，定位/外点关闭等行为全由 antd 托管）。
 */
export function AttachPanel({ disabled, onAttach, onSketch }: AttachPanelProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const [open, setOpen] = useState(false)

    /** 选项后收起面板（上传/画板各自的流程接管后续交互） */
    const pick = (action: () => void) => () => {
        setOpen(false)
        action()
    }

    const content = (
        <Panel data-testid="attach-panel" onClick={(e) => e.stopPropagation()}>
            <GroupTitle>{t('composer.attachPanelTitle')}</GroupTitle>
            <PanelItem
                icon={<Paperclip size={16} />}
                title={t('composer.attachFile')}
                onClick={pick(() => onAttach('file'))}
            />
            {isMobile && (
                <PanelItem
                    icon={<Camera size={16} />}
                    title={t('composer.attachCamera')}
                    onClick={pick(() => onAttach('camera'))}
                />
            )}
            {onSketch && (
                <PanelItem
                    icon={<PenLine size={16} />}
                    title={t('sketch.open')}
                    onClick={pick(onSketch)}
                />
            )}
        </Panel>
    )

    return (
        <Dropdown
            open={open}
            onOpenChange={setOpen}
            trigger={['click']}
            placement="topLeft"
            popupRender={() => content}
        >
            <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                aria-label={t('composer.attach')}
                disabled={disabled}
                data-testid="attach-trigger"
            />
        </Dropdown>
    )
}
