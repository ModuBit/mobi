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

import { useState, useEffect } from 'react'
import { theme as antTheme, Input } from 'antd'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useNavigate, useRouter, useCanGoBack } from '@tanstack/react-router'
import { ChevronLeft, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMediaQuery } from '@/core/data/hooks/useMediaQuery'
import { SETTINGS_WIDE_QUERY, activeSection, searchSettingsSectionGroups, type SettingsSection } from '@/features/settings/sections/registry'
import { writeLastSettingsSection } from '@/features/settings/sections/lastSettingsSection'
import { WebToolsStatusBadge } from '@/features/settings/sections/WebToolsStatusBadge'
import { resolveSettingsBackTarget } from '@/features/layout/settingsReturnOrigin'

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

const BackButton = styled.button<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    padding: 6px 10px 6px 6px;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: ${p => p.$token.borderRadius}px;
    color: ${p => p.$token.colorTextSecondary};
    font-size: 13px;
    &:hover { background: ${p => p.$token.colorFillQuaternary}; }
    &:focus-visible {
        outline: 2px solid ${p => p.$token.colorPrimary};
        outline-offset: 2px;
    }
`

const SidebarTitle = styled.div<{ $token: Token }>`
    padding: 0 6px;
    font-size: 15px;
    font-weight: 600;
    color: ${p => p.$token.colorText};
`

const SearchSlot = styled.div`
    padding: 0 6px;
`

const NavGroups = styled.nav`
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
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: none;
    cursor: pointer;
    border-radius: ${p => p.$token.borderRadius}px;
    font-size: 13.5px;
    text-align: left;
    background: ${p => (p.$active ? p.$token.colorFillSecondary : 'transparent')};
    color: ${p => (p.$active ? p.$token.colorText : p.$token.colorTextSecondary)};
    font-weight: ${p => (p.$active ? 600 : 400)};
    &:hover { background: ${p => p.$token.colorFillQuaternary}; }
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

/** PC 分区内容：居中限宽（ChatGPT 内容形态），纵向滚动 */
const SectionMain = styled.main`
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 28px 32px max(28px, env(safe-area-inset-bottom));
`

const SectionMainInner = styled.div`
    max-width: 860px;
    margin: 0 auto;
`

/** mobile 形态沿用的内容容器：避让 home 指示条 */
const SettingsContent = styled.div<{ $token: Token }>`
    flex: 1;
    min-height: 0; /* flex 子项可缩小，overflow 才生效（父 Content overflow:hidden） */
    overflow-y: auto;
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
    width: 36px;
    height: 36px;
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

/** 返回链路收尾（history.back 优先，无应用内历史落来源记录，最后兜底新对话）：PC 侧栏与 mobile 头部共用 */
function useSettingsBack(): () => void {
    const navigate = useNavigate()
    const router = useRouter()
    const canGoBack = useCanGoBack()
    return () => {
        const target = resolveSettingsBackTarget(canGoBack)
        if (target.mode === 'history') router.history.back()
        else void navigate({ to: target.to })
    }
}

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

    return (
        <SettingsSidebar $token={$token}>
            <SidebarScroll>
                <BackButton $token={$token} aria-label={t('common.back')} onClick={goBack}>
                    <ChevronLeft size={16} />
                    {t('common.back')}
                </BackButton>
                <SidebarTitle $token={$token}>{t('settings.title')}</SidebarTitle>
                <SearchSlot>
                    <Input
                        allowClear
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder={t('settings.search')}
                        prefix={<Search size={14} />}
                        size="small"
                        aria-label={t('settings.search')}
                    />
                </SearchSlot>
                <NavGroups aria-label={t('settings.title')}>
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
                                            onClick={() => { void navigate({ to: `/settings/${section.id}` }) }}
                                        >
                                            <NavIcon><Icon size={15} opacity={0.75} /></NavIcon>
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
    const goBack = useSettingsBack()
    const active = activeSection(location.pathname)

    // 记住上次分区：激活分区变化即写（深链以 URL 为准并覆盖记录）
    useEffect(() => {
        if (active) writeLastSettingsSection(active.id)
    }, [active])

    if (!isWide) {
        // activeSection 已校验段在 SETTINGS_SECTIONS 内，未知段返回 null（回到入口态标题）
        const titleKey = active?.titleKey ?? 'settings.title'
        // 头部收敛（ChatGPT 移动端形态）：返回箭头 + 居中标题，无汉堡并存。
        // 子页返回 = 回入口列表；入口态返回 = 离开设置（与 PC 同一返回链路裁决）
        const handleMobileBack = () => {
            if (active) {
                void navigate({ to: '/settings' })
                return
            }
            goBack()
        }
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
                <SettingsContent $token={token}>
                    <Outlet />
                </SettingsContent>
            </div>
        )
    }

    // PC：全屏接管壳（侧栏 keyword 状态收在 Sidebar 内，键入不重渲染 Outlet 子树）
    return (
        <SettingsTakeover>
            <Sidebar $token={token} active={active} goBack={goBack} />
            <SectionMain>
                <SectionMainInner>
                    <Outlet />
                </SectionMainInner>
            </SectionMain>
        </SettingsTakeover>
    )
}
