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

import { theme as antTheme } from 'antd'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import styled from '@emotion/styled'
import { useNavigate } from '@tanstack/react-router'
import { Logo } from './Logo'
import { MobiWordmark } from './MobiWordmark'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'

const { useToken } = antTheme

/** macOS 三色按钮区宽度（浮在内容上，env 不反映，用固定值避让） */
const MAC_TRAFFIC_PAD = '78px'

/**
 * 浏览器 chrome（标签栏/地址栏）与 WcoTitleBar 统一使用的背景色。
 * 跟 html 背景色（base.css）一致：亮 #ffffff / 暗 #141414，
 * 不用 antd token（shadcn override 的 colorBgContainer=#faf9f5 / colorBgLayout=#141413 与 html 不同源，
 * 会导致 chrome 标签栏与窗口边缘色差、以及刷新时 #ffffff↔#faf9f5 闪烁）。
 */
const CHROME_BG_LIGHT = '#ffffff'
const CHROME_BG_DARK = '#141414'

/** 解析当前主题对应的 chrome 背景色。MainLayout 设 theme-color 与 WcoTitleBar 背景共用，保证同源 */
export function resolveChromeColor(theme: 'light' | 'dark'): string {
    return theme === 'dark' ? CHROME_BG_DARK : CHROME_BG_LIGHT
}

/** 标题栏两侧：mac 三色在左，win 按钮在右 */
type TitleBarSide = 'mac' | 'win'

interface WcoTitleBarProps {
    /** 窗口控制按钮所在侧。默认按 navigator 自动探测；测试可显式传入 */
    side?: TitleBarSide
}

/**
 * Window Controls Overlay 自定义标题栏。
 *
 * 恒定内容：Logo + 品牌名 + 侧边栏收起按钮（左侧 cluster）+ 拖拽区（占满剩余空间）。
 * 系统窗口控制按钮（macOS 三色 / Windows min/max/close）浮在本组件之上，通过 padding 避让。
 *
 * per-session 信息（会话名、操作按钮）不在本组件——保留在各页面 PageHeader。
 */
const TitleBarRoot = styled.div<{ $bg: string }>`
    display: flex;
    align-items: center;
    height: 38px;
    flex-shrink: 0;
    background: ${p => p.$bg};
    /* 无 border-bottom：与下方内容区无缝融合，避免割裂感 */
    /* 整条标题栏可拖拽移动窗口；左侧 cluster 单独 no-drag */
    -webkit-app-region: drag;
    app-region: drag;
    user-select: none;
    z-index: 10;
`

const LeftCluster = styled.div`
    display: flex;
    align-items: center;
    gap: 4px;
    -webkit-app-region: no-drag;
    app-region: no-drag;
`

const LogoArea = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: ${p => p.$token.colorText};
    border-radius: 6px;
    padding: 4px 6px;

    &:hover {
        background: ${p => p.$token.colorBgTextHover};
    }
`

const CollapseButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    background: transparent;
    color: ${p => p.$token.colorTextSecondary};
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;

    &:hover {
        background: ${p => p.$token.colorBgTextHover};
        color: ${p => p.$token.colorText};
    }
`

/** 拖拽区：占满剩余空间（纯空白，承载窗口拖拽） */
const DragRegion = styled.div`
    flex: 1;
    height: 100%;
`

/** 探测窗口控制按钮所在侧：macOS 三色在左，其余（Windows/Linux）在右。
 *  平台在会话期间不变，模块级缓存避免每次渲染重复探测 */
let cachedSide: TitleBarSide | undefined
function detectSide(): TitleBarSide {
    if (cachedSide) return cachedSide
    if (typeof navigator === 'undefined') {
        cachedSide = 'win'
        return cachedSide
    }
    const uaData = (navigator as Navigator & {
        userAgentData?: { platform: string }
    }).userAgentData
    const platform = uaData?.platform ?? navigator.platform ?? ''
    cachedSide = /mac/i.test(platform) ? 'mac' : 'win'
    return cachedSide
}

export function WcoTitleBar({ side }: WcoTitleBarProps) {
    const { token } = useToken()
    const navigate = useNavigate()
    const theme = useUiStore((s) => s.theme)
    const sidebarExpanded = useUiStore((s) => s.sidebarExpanded)
    const toggleSidebar = useUiStore((s) => s.toggleSidebar)
    const resolvedTheme = resolveTheme(theme)

    const resolvedSide = side ?? detectSide()

    // 背景跟 html 窗口底色一致（resolveChromeColor），不随 antd token 变化
    const bgColor = resolveChromeColor(resolvedTheme)

    // macOS 三色按钮在左 → 左 padding 避让；Windows/Linux 按钮在右 → env(titlebar-area-width) 已扣除按钮宽
    const sideStyle: React.CSSProperties = resolvedSide === 'mac'
        ? { paddingLeft: MAC_TRAFFIC_PAD, paddingRight: '8px' }
        : { paddingLeft: '8px', paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw))' }

    return (
        <TitleBarRoot
            className={resolvedSide === 'mac' ? 'wco-titlebar-mac' : 'wco-titlebar-win'}
            style={sideStyle}
            $bg={bgColor}
        >
            <LeftCluster>
                <LogoArea
                    $token={token}
                    onClick={() => navigate({ to: '/sessions/new', search: { cwd: undefined } })}
                    aria-label="Mobi"
                >
                    <Logo style={{ width: 18, height: 18 }} />
                    <MobiWordmark size={14} />
                </LogoArea>
                <CollapseButton
                    $token={token}
                    onClick={toggleSidebar}
                    aria-label={sidebarExpanded ? '收起侧边栏' : '展开侧边栏'}
                >
                    {sidebarExpanded
                        ? <PanelLeftClose size={16} />
                        : <PanelLeftOpen size={16} />}
                </CollapseButton>
            </LeftCluster>
            <DragRegion />
        </TitleBarRoot>
    )
}
