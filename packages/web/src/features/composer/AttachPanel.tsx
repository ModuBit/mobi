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
 * 附加面板（composer「+」按钮的弹出菜单）：
 * 分组标题 + 菜单项（图标 + 主文字）；移动端相机入口拆「拍照/录像」两项并排一行
 * （各自单类型 accept + capture，Android Chrome 才会直开相机，见 handleAttach 注释）。
 *
 * 承载用 registry 的 DropdownMenu（uiarc）——与全站菜单同一套弹层观感（面板外壳/入场动效/
 * 选中高亮），antd Dropdown 的自绘面板会另成一套外观。两项非菜单项内容（标题、相机行）走
 * `content`：它们不参与菜单键盘漫游，也不该被当成可选项。
 * 相机的两个按钮自持样式与菜单项同形（同尺寸/hover 档），因为菜单一行只能一个可选项。
 * 关闭：菜单项选中即关（Radix 内建），原 `pick()` 的 setOpen(false) 随之删除；相机行走
 * `content`（非菜单项），Radix 不会替它关，故本组件受控 open，点完自己收面板。
 */

import { useState, type ReactNode } from 'react'
import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { Camera, Paperclip, PenLine, Video } from 'lucide-react'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import { DropdownMenu, type DropdownItem } from '@/ui/base/interactive/dropdown-menu/DropdownMenu'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'

export interface AttachPanelProps {
    disabled?: boolean
    /** 打开系统选择器（file=文件；photo/video=移动端直开相机/摄像机），由调用方 handleAttach 承接 */
    onAttach: (source: 'file' | 'photo' | 'video') => void
    /** 打开画板；缺省不渲染画板项（新建页无画板入口） */
    onSketch?: () => void
}

/* 弹层里的一切都要用 cssVars.ts 注入 :root/.dark 的全局变量（弹层 portal 到 body，
   antd 的 --ant-* 只在 antd 组件子树内可解析，此处会取空） */

/* 分组标题：弱化但清晰可读（用户指定加大，不压到菜单项之下）；不参与漫游的 content 项，
   横向内边距与菜单项对齐（面板自身 padding 5px + 11px） */
const GroupTitle = styled.div`
    padding: 5px 11px 3px;
    font-size: 13px;
    color: var(--text-secondary);
`

/* 相机行的两个按钮：与菜单项同形（高度/内边距/图标间距/圆角/hover 档一致），
   因为菜单项一行只能放一个可选项，并排两个只能落在 content 里自持样式 */
const RowItem = styled.button`
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 36px;
    padding: 0 11px;
    border: none;
    border-radius: calc(var(--radius-panel) - 6px);
    background: transparent;
    color: var(--foreground);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--mobi-duration-fast) var(--mobi-ease-in-out);

    & svg { flex: none; color: var(--text-secondary); }
    &:hover { background: var(--surface-muted); }
`

/* 相机行：拍照/录像并排（用户指定两项同行、内容左对齐，与文件/画板项一致） */
const CameraRow = styled.div`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 2px 0;
`

/** 相机行单项（与菜单项同形，仅供相机行的两个并排项使用） */
function RowButton({ icon, title, onClick }: { icon: ReactNode; title: string; onClick: () => void }) {
    return (
        <RowItem type="button" onClick={onClick}>
            {icon}
            <span>{title}</span>
        </RowItem>
    )
}

export function AttachPanel({ disabled, onAttach, onSketch }: AttachPanelProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    // 受控开合：只为相机行能自己收面板（menu 项选中即关由 Radix 负责）
    const [open, setOpen] = useState(false)

    /** 相机行：先跑动作，再收面板（`content` 项不会被 Radix 当成选中） */
    const pickCamera = (source: 'photo' | 'video') => {
        onAttach(source)
        setOpen(false)
    }

    const items: DropdownItem[] = [
        { key: 'title', content: <GroupTitle>{t('composer.attachPanelTitle')}</GroupTitle> },
        {
            key: 'file',
            icon: <Paperclip size={16} />,
            label: t('composer.attachFile'),
            onSelect: () => onAttach('file'),
        },
        ...(isMobile
            ? [{
                key: 'camera',
                content: (
                    <CameraRow>
                        <RowButton
                            icon={<Camera size={16} />}
                            title={t('composer.attachPhoto')}
                            onClick={() => pickCamera('photo')}
                        />
                        <RowButton
                            icon={<Video size={16} />}
                            title={t('composer.attachRecord')}
                            onClick={() => pickCamera('video')}
                        />
                    </CameraRow>
                ),
            }]
            : []),
        ...(onSketch
            ? [{
                key: 'sketch',
                icon: <PenLine size={16} />,
                label: t('sketch.open'),
                onSelect: onSketch,
            }]
            : []),
    ]

    return (
        <DropdownMenu
            trigger={
                <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    aria-label={t('composer.attach')}
                    disabled={disabled}
                    data-testid="attach-trigger"
                />
            }
            items={items}
            side="top"
            align="start"
            open={open}
            onOpenChange={setOpen}
        />
    )
}
