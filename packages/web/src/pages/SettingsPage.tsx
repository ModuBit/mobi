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

import { useState, useEffect, Suspense } from 'react'
import { theme as antTheme } from 'antd'
import { css } from '@emotion/react'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { SearchField } from '@/ui/base/interactive/search-field/SearchField'
import { useMediaQuery } from '@/core/data/hooks/useMediaQuery'
import { SETTINGS_WIDE_QUERY, activeSection, searchSettingsSectionGroups, type SettingsSection } from '@/features/settings/sections/registry'
import { writeLastSettingsSection } from '@/features/settings/sections/lastSettingsSection'
import { WebToolsStatusBadge } from '@/features/settings/sections/WebToolsStatusBadge'
import { resolveSettingsLeaveTarget } from '@/features/layout/settingsReturnOrigin'
import { GlideLayer, HoverGlideLayer } from '@/ui/base/motion/GlideLayer'
import { useGlideHighlight } from '@/ui/base/motion/useGlideHighlight'

const { useToken } = antTheme

type Token = ReturnType<typeof useToken>['token']

/** PC 全屏接管壳：设置视图占满内容区（MainLayout 已让位主侧栏） */
const SettingsTakeover = styled.div`
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
`

const SettingsSidebar = styled.aside<{ $token: Token }>`
    width: 248px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid ${p => p.$token.colorBorderSecondary};
    background: ${p => p.$token.colorBgContainer};
    min-height: 0;
`

const SidebarScroll = styled.div`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 12px 12px 16px;
    gap: 12px;
`

/** 头部行：返回 icon 与「设置」标题同一行（整行可点 = 返回），标题字号与导航层级匹配 */
const SettingsHeaderRow = styled.button<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: 8px;
    align-self: stretch;
    padding: 6px 10px 6px 6px;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: ${p => p.$token.borderRadius}px;
    color: ${p => p.$token.colorText};
    font-size: 16px;
    font-weight: 600;
    text-align: left;
    &:hover { background: ${p => p.$token.colorFillQuaternary}; }
    &:focus-visible {
        outline: 2px solid ${p => p.$token.colorPrimary};
        outline-offset: 2px;
    }
`

const SearchSlot = styled.div`
    padding: 0 2px;
`

const NavGroups = styled.nav`
    position: relative; /* 滑移底色层的定位容器（层与行平级，几何取行 offsetTop） */
    isolation: isolate; /* 滑移层 z-index:-1 落在内容之下、容器背景之上 */
    display: flex;
    flex-direction: column;
    gap: 14px;
`

const GroupLabel = styled.div<{ $token: Token }>`
    padding: 0 8px 2px;
    font-size: 12px;
    font-weight: 500;
    color: ${p => p.$token.colorTextTertiary};
`

const NavList = styled.div`
    display: flex;
    flex-direction: column;
    gap: 2px;
`

const NavItem = styled.button<{ $token: Token; $active: boolean }>`
    position: relative; /* 盖在滑移底色层之上（层在行之前渲染，无 z-index） */
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: none;
    cursor: pointer;
    border-radius: ${p => p.$token.borderRadius}px;
    font-size: 13.5px;
    text-align: left;
    /* 底色由滑移层绘制（hover/selected 两档），行只负责文字与字重 */
    background: transparent;
    color: ${p => (p.$active ? p.$token.colorText : p.$token.colorTextSecondary)};
    font-weight: ${p => (p.$active ? 600 : 400)};
    &:focus-visible {
        outline: 2px solid ${p => p.$token.colorPrimary};
        outline-offset: 2px;
    }
`

const NavIcon = styled.span`
    display: flex;
    flex-shrink: 0;
`

const NavBadge = styled.span`
    margin-left: auto;
    display: flex;
    flex-shrink: 0;
`

const EmptyHint = styled.div<{ $token: Token }>`
    padding: 8px;
    font-size: 12.5px;
    color: ${p => p.$token.colorTextTertiary};
`

/**
 * PC 分区内容：居中限宽（ChatGPT 内容形态），纵向滚动。
 * $fill（列表流分区，registry layout:'fill'）：壳只让出滚动（overflow:hidden + flex
 * 纵向链），滚动权交给分区组件满高内滚——Listy 虚拟滚动需要限高容器，整区滚动会把它撑开
 */
const SectionMain = styled.main<{ $fill: boolean }>`
    flex: 1;
    min-width: 0;
    overflow-y: ${p => (p.$fill ? 'hidden' : 'auto')};
    ${p => p.$fill && css`
        display: flex;
        flex-direction: column;
    `}
    padding: 28px 32px max(28px, env(safe-area-inset-bottom));
`

const SectionMainInner = styled.div<{ $fill: boolean }>`
    max-width: 860px;
    margin: 0 auto;
    ${p => p.$fill && css`
        height: 100%;
        display: flex;
        flex-direction: column;
    `}
`

/** 分区页题（Codex 形态）：内容区顶部大字号分区名，与组卡小标题（组标签层）区分层级 */
const SectionTitle = styled.h1<{ $token: Token }>`
    margin: 0 0 16px;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
    color: ${p => p.$token.colorText};
`

/**
 * 分区 chunk 拉取占位：分区是独立 lazy chunk，suspend 必须在本层被接住——
 * 冒泡到 App 根级 Suspense 会全屏替换（设置侧栏一起消失，切换分区看起来整页在 loading）。
 * 形态与分区自身查询占位（Placeholder min-height）一致，chunk 拉取完成后无缝续接。
 */
const SectionFallback = styled.div`
    min-height: 240px;
`

/**
 * mobile 形态沿用的内容容器：避让 home 指示条。
 * $fill（列表流分区）：同 PC——壳只让出滚动，分区组件满高内滚
 */
const SettingsContent = styled.div<{ $token: Token; $fill: boolean }>`
    flex: 1;
    min-height: 0; /* flex 子项可缩小，overflow 才生效（父 Content overflow:hidden） */
    overflow-y: ${p => (p.$fill ? 'hidden' : 'auto')};
    display: flex;
    flex-direction: column;
    /* 底部避让 home 指示条；桌面 env=0 保持 24px */
    padding: 24px 24px max(24px, env(safe-area-inset-bottom));
`

/** mobile 设置头部（ChatGPT 移动端形态）：返回箭头 + 居中标题三栏；避让 PWA 刘海 */
const MobileHeader = styled.header<{ $token: Token }>`
    display: grid;
    grid-template-columns: 48px 1fr 48px;
    align-items: center;
    height: 48px;
    flex-shrink: 0;
    padding-top: max(0px, env(safe-area-inset-top));
`

const MobileHeaderSide = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
`

const MobileBackButton = styled.button<{ $token: Token }>`
    border: none;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    /* 44×44 触屏命中区下限（MobileHeader 侧栏格 48px 容纳） */
    width: 44px;
    height: 44px;
    border-radius: var(--radius-pill);
    color: ${p => p.$token.colorText};
    &:active { background: ${p => p.$token.colorFillQuaternary}; }
    &:focus-visible {
        outline: 2px solid ${p => p.$token.colorPrimary};
        outline-offset: 2px;
    }
`

const MobileHeaderTitle = styled.div<{ $token: Token }>`
    text-align: center;
    font-size: 16px;
    font-weight: 600;
    color: ${p => p.$token.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

interface SidebarProps {
    $token: Token
    active: SettingsSection | null
    goBack: () => void
}

/** PC 侧栏（返回键 + 标题 + 分区搜索 + 分组导航）。keyword 状态收在内部：键入不重渲染 Outlet 子树 */
function Sidebar({ $token, active, goBack }: SidebarProps) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const [keyword, setKeyword] = useState('')
    const groups = searchSettingsSectionGroups(keyword, t)
    // 悬停 / 激活两档滑移底色（与主侧栏导航同一套弹簧手感，跨分组滑移）
    const { containerRef, activeEl } = useGlideHighlight<HTMLDivElement>()

    return (
        <SettingsSidebar $token={$token}>
            <SidebarScroll>
                {/* 头部行：返回 icon + 标题同一行，整行可点 = 返回（含离开设置） */}
                <SettingsHeaderRow $token={$token} aria-label={t('common.back')} onClick={goBack}>
                    <ChevronLeft size={18} />
                    {t('settings.title')}
                </SettingsHeaderRow>
                <SearchSlot>
                    <SearchField
                        value={keyword}
                        onValueChange={setKeyword}
                        placeholder={t('settings.search')}
                        aria-label={t('settings.search')}
                    />
                </SearchSlot>
                <NavGroups aria-label={t('settings.title')} ref={containerRef}>
                    {/* 滑移底色层：hover 最淡一档、active 深半档，跨分组弹簧滑移（行零重渲染） */}
                    <HoverGlideLayer containerRef={containerRef} $background={$token.colorBgTextHover} />
                    <GlideLayer target={activeEl} $background={$token.colorPrimaryBg} />
                    {groups.map((group) => (
                        <div key={group.id}>
                            <GroupLabel $token={$token}>{t(group.titleKey)}</GroupLabel>
                            <NavList>
                                {group.sections.map((section: SettingsSection) => {
                                    const Icon: LucideIcon = section.icon
                                    const isActive = active?.id === section.id
                                    return (
                                        <NavItem
                                            key={section.id}
                                            $token={$token}
                                            $active={isActive}
                                            aria-current={isActive ? 'page' : undefined}
                                            data-glide-row=""
                                            data-glide-active={isActive ? 'true' : undefined}
                                            onClick={() => { void navigate({ to: `/settings/${section.id}` }) }}
                                        >
                                            {/* 描边配行字重：600 行 2px、400 行 1.5px（与 SettingRow 同语言）；弱化交给行的 color token */}
                                            <NavIcon><Icon size={15} strokeWidth={isActive ? 2 : 1.5} /></NavIcon>
                                            {t(section.titleKey)}
                                            {section.badge === 'web-tools-status' && (
                                                <NavBadge><WebToolsStatusBadge variant="compact" /></NavBadge>
                                            )}
                                        </NavItem>
                                    )
                                })}
                            </NavList>
                        </div>
                    ))}
                    {groups.length === 0 && <EmptyHint $token={$token}>{t('settings.searchEmpty')}</EmptyHint>}
                </NavGroups>
            </SidebarScroll>
        </SettingsSidebar>
    )
}
/**
 * 设置布局壳（/settings 路由族组件）：
 * - PC（≥992px）：全屏接管视图——自带侧栏（返回键 + 标题 + 分区搜索 + 分组导航），MainLayout 已让位主侧栏
 * - mobile（<992px）：主侧栏不受影响；Outlet 直渲染，子页 appbar 带返回键（← 回 /settings 入口列表）
 */
export function SettingsPage() {
    const { token } = useToken()
    const { t } = useTranslation()
    const isWide = useMediaQuery(SETTINGS_WIDE_QUERY)
    const location = useLocation()
    const navigate = useNavigate()
    const active = activeSection(location.pathname)
    // 返回 = 离开设置：恒落来源记录（打开设置前的页面），不在设置内逐级回走历史——
    // A→B→C 切过之后 history.back 会依次弹回 B、A，而侧栏常驻下用户意图就是「回去」
    const goBack = () => { void navigate({ to: resolveSettingsLeaveTarget().to }) }

    // 记住上次分区：激活分区变化即写（深链以 URL 为准并覆盖记录）
    useEffect(() => {
        if (active) writeLastSettingsSection(active.id)
    }, [active])

    if (!isWide) {
        // activeSection 已校验段在 SETTINGS_SECTIONS 内，未知段返回 null（回到入口态标题）
        const titleKey = active?.titleKey ?? 'settings.title'
        // 头部收敛（ChatGPT 移动端形态）：返回箭头 + 居中标题，无汉堡并存。
        // 子页返回 = 回入口列表；入口态返回 = 离开设置——恒走来源记录兜底链，
        // 不用 history.back：子分区→入口是 push，back 会弹回子分区困在设置内
        const handleMobileBack = () => {
            if (active) {
                void navigate({ to: '/settings' })
                return
            }
            const target = resolveSettingsLeaveTarget()
            void navigate({ to: target.to })
        }
        const fill = active?.layout === 'fill'
        return (
            <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
                <MobileHeader $token={token}>
                    <MobileHeaderSide>
                        <MobileBackButton $token={token} aria-label={t('common.back')} onClick={handleMobileBack}>
                            <ChevronLeft size={20} />
                        </MobileBackButton>
                    </MobileHeaderSide>
                    <MobileHeaderTitle $token={token}>{t(titleKey)}</MobileHeaderTitle>
                    <MobileHeaderSide />
                </MobileHeader>
                <SettingsContent $token={token} $fill={fill}>
                    <Suspense fallback={<SectionFallback />}>
                        <Outlet />
                    </Suspense>
                </SettingsContent>
            </div>
        )
    }

    // PC：全屏接管壳（侧栏 keyword 状态收在 Sidebar 内，键入不重渲染 Outlet 子树）
    const fill = active?.layout === 'fill'
    return (
        <SettingsTakeover>
            <Sidebar $token={token} active={active} goBack={goBack} />
            <SectionMain $fill={fill}>
                <SectionMainInner $fill={fill}>
                    <SectionTitle $token={token}>{t(active?.titleKey ?? 'settings.title')}</SectionTitle>
                    <Suspense fallback={<SectionFallback />}>
                        <Outlet />
                    </Suspense>
                </SectionMainInner>
            </SectionMain>
        </SettingsTakeover>
    )
}
