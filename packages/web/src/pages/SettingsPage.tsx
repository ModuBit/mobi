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

import { Typography, theme as antTheme } from 'antd'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import styled from '@emotion/styled'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { SidebarToggle } from '@/components/layout/SidebarToggle'
import { PageHeader } from '@/components/layout/PageHeader'
import { useMediaQuery } from '@/core/data/hooks/useMediaQuery'
import { SETTINGS_SECTIONS, activeSectionId } from '@/components/settings/sections/registry'

const { Title } = Typography
const { useToken } = antTheme

/** 设置分区导航断点：≥992px 显示左侧分区导航（主侧栏240+分区导航200+内容720 的宽度预算） */
export const SETTINGS_WIDE_QUERY = '(min-width: 992px)'

const SettingsContainer = styled.div`
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
`

const SettingsContent = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    flex: 1;
    min-height: 0; /* flex 子项可缩小，overflow 才生效（父 Content overflow:hidden） */
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    /* 底部避让 home 指示条；桌面 env=0 保持 24px */
    padding: 24px 24px max(24px, env(safe-area-inset-bottom));
`

/** PC 形态：左侧分区导航 + 右侧内容 */
const Split = styled.div`
    display: flex;
    gap: 28px;
    align-items: flex-start;
    max-width: 1160px;
    margin: 0 auto;
    width: 100%;
`

const SubNav = styled.nav`
    width: 200px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    position: sticky;
    top: 0;
`

const SubNavItem = styled.button<{ $token: ReturnType<typeof useToken>['token']; $active: boolean }>`
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 10px 12px;
    border: none;
    cursor: pointer;
    border-radius: 9px;
    font-size: 13.5px;
    text-align: left;
    background: ${p => p.$active ? p.$token.colorBgContainer : 'transparent'};
    color: ${p => p.$active ? p.$token.colorText : p.$token.colorTextSecondary};
    font-weight: ${p => p.$active ? 600 : 400};
    box-shadow: ${p => p.$active
        ? `0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px ${p.$token.colorBorderSecondary}`
        : 'none'};
    /* 键盘可达性：focus-visible 用主题色描边 */
    &:focus-visible {
        outline: 2px solid ${p => p.$token.colorPrimary};
        outline-offset: 2px;
    }
`

const SectionMain = styled.main`
    flex: 1;
    min-width: 0;
    max-width: 720px;
`

/**
 * 设置页响应式壳：
 * - PC（≥992px）：左侧分区导航（200px）+ 右侧 Outlet 内容
 * - mobile（<992px）：Outlet 直接渲染；子页 appbar 带返回键（← 回 /settings 入口列表）
 */
export function SettingsLayout() {
    const { token } = useToken()
    const { t } = useTranslation()
    const isWide = useMediaQuery(SETTINGS_WIDE_QUERY)
    const location = useLocation()
    const navigate = useNavigate()
    const active = activeSectionId(location.pathname)
    const sections = SETTINGS_SECTIONS.filter((s) => s.visible())

    if (!isWide) {
        // activeSectionId 已校验段在 SETTINGS_SECTIONS 内，未知段返回 null（回到入口态标题）
        const titleKey = active
            ? SETTINGS_SECTIONS.find((s) => s.id === active)?.titleKey ?? 'settings.title'
            : 'settings.title'
        return (
            <SettingsContainer>
                <PageHeader
                    left={<>
                        {active ? (
                            <button
                                aria-label={t('common.back')}
                                onClick={() => { void navigate({ to: '/settings' }) }}
                                style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', color: token.colorTextSecondary, padding: 4 }}
                            >
                                <ChevronLeft size={18} />
                            </button>
                        ) : <SidebarToggle />}
                        <MobileMenuButton />
                        <Title level={5} style={{ margin: 0 }}>{t(titleKey)}</Title>
                    </>}
                />
                <SettingsContent $token={token}>
                    <Outlet />
                </SettingsContent>
            </SettingsContainer>
        )
    }

    return (
        <SettingsContainer>
            <PageHeader
                left={<>
                    <SidebarToggle />
                    <Title level={5} style={{ margin: 0 }}>{t('settings.title')}</Title>
                </>}
            />
            <SettingsContent $token={token}>
                <Split>
                    <SubNav>
                        {sections.map((s) => {
                            const Icon = s.icon
                            return (
                                <SubNavItem
                                    key={s.id}
                                    $token={token}
                                    $active={active === s.id}
                                    onClick={() => { void navigate({ to: `/settings/${s.id}` }) }}
                                >
                                    <Icon size={16} opacity={0.75} />
                                    {t(s.titleKey)}
                                </SubNavItem>
                            )
                        })}
                    </SubNav>
                    <SectionMain>
                        <Outlet />
                    </SectionMain>
                </Split>
            </SettingsContent>
        </SettingsContainer>
    )
}
