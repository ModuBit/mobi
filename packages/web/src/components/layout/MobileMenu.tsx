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
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { useUiStore } from '@/core/data/stores/uiStore'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { mobileNavItems, logoutNavItem, navPathMap, getNavActiveKey } from './navConfig'
import { useThemeLocaleToggle } from './useThemeLocaleToggle'
import { MobileMenuItem } from './mobileMenu.styles'
import { MobileProjectList } from './MobileProjectList'
import { MobileDrawer } from '@/components/ui/MobileDrawer'
import { Menu, Sun, Moon, Languages, RefreshCw, RotateCw } from 'lucide-react'
import { InstallButton } from './InstallButton'
import { useForceUpdate } from '@/core/pwa/useForceUpdate'
import { usePwaMode } from '@/components/layout/usePwaMode'
import styled from '@emotion/styled'

const { useToken } = antTheme

const MenuButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorText};
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;

    @media (hover: hover) {
        &:hover {
            background: ${props => props.$token.colorPrimaryBg};
            color: ${props => props.$token.colorPrimary};
        }
    }

    &:active {
        background: ${props => props.$token.colorPrimaryBg};
        color: ${props => props.$token.colorPrimary};
    }
`

const MenuContent = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    background: ${props => props.$token.colorBgContainer};
`

// 汉堡菜单按钮
export function MobileMenuButton() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { setMobileMenuOpen } = useUiStore()
    const isMobile = useIsMobile()

    if (!isMobile) return null

    return (
        <MenuButton
            $token={token}
            onClick={() => setMobileMenuOpen(true)}
            aria-label={t('nav.menu')}
        >
            <Menu size={20} />
        </MenuButton>
    )
}

// 底部弹出的菜单
export function MobileMenuDrawer() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const location = useLocation()
    const { mobileMenuOpen, setMobileMenuOpen } = useUiStore()
    const { logout } = useAuthStore()
    const api = useMobiApi()
    const isMobile = useIsMobile()
    const { resolvedTheme, locale, toggleTheme, toggleLocale } = useThemeLocaleToggle()
    const restart = useForceUpdate()
    // 刷新/重启 仅 PWA(standalone)有意义:浏览器有自带刷新按钮,PWA 无浏览器 chrome
    const isPwa = usePwaMode()

    // 关闭菜单
    const handleClose = () => setMobileMenuOpen(false)

    // 登出：先清服务端 cookie，再清内存 state（cookie 链路下两步缺一不可）
    const handleLogout = () => {
        handleClose()
        api.auth.logout().catch(() => {}).finally(() => logout())
    }

    // 选择菜单项
    const handleSelect = (key: string) => {
        const path = navPathMap[key]
        if (path) {
            navigate({ to: path })
        }
        handleClose()
    }

    // 非移动端不渲染
    if (!isMobile) return null

    // 将菜单项拆分为「新建会话」和「设置」两组，中间插入项目列表
    const topItems = mobileNavItems.filter(item => item.key === 'new-session')
    const bottomItems = mobileNavItems.filter(item => item.key !== 'new-session')

    return (
        <MobileDrawer
            title={t('nav.menu')}
            open={mobileMenuOpen}
            onClose={handleClose}
            // body overflow 不允许覆盖（MobileDrawer 布局不变量：拖拽把手固定、内容区自滚），
            // 这里只按移动端 Drawer 规范补底部安全边界，防「退出登录」被底部横条遮挡
            styles={{ body: { paddingBottom: 'max(24px, env(safe-area-inset-bottom))' } }}
        >
            <MenuContent $token={token}>
                {/* 新建会话 */}
                {topItems.map((item) => (
                    <MobileMenuItem
                        key={item.key}
                        $active={getNavActiveKey(location.pathname, item.key)}
                        $token={token}
                        onClick={() => handleSelect(item.key)}
                    >
                        <item.icon size={20} />
                        <span>{t(item.labelKey)}</span>
                    </MobileMenuItem>
                ))}

                {/* 项目列表 */}
                <MobileProjectList onCloseMenu={handleClose} />

                {/* 设置等 */}
                {bottomItems.map((item) => (
                    <MobileMenuItem
                        key={item.key}
                        $active={getNavActiveKey(location.pathname, item.key)}
                        $token={token}
                        onClick={() => handleSelect(item.key)}
                    >
                        <item.icon size={20} />
                        <span>{t(item.labelKey)}</span>
                    </MobileMenuItem>
                ))}

                {/* PWA 安装按钮 */}
                <InstallButton variant="menu" />

                {/* 主题 & 语言切换（双列行：列内左对齐，左列图标起点与其他行一致） */}
                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                    <MobileMenuItem
                        $active={false}
                        $token={token}
                        style={{ flex: 1 }}
                        onClick={toggleTheme}
                    >
                        {resolvedTheme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                        <span>{resolvedTheme === 'dark' ? t('nav.themeLight') : t('nav.themeDark')}</span>
                    </MobileMenuItem>
                    <div style={{ width: 1, alignSelf: 'stretch', background: token.colorBorder, margin: '8px 0' }} />
                    <MobileMenuItem
                        $active={false}
                        $token={token}
                        style={{ flex: 1 }}
                        onClick={toggleLocale}
                    >
                        <Languages size={20} />
                        <span>{locale === 'zh' ? 'English' : '中文'}</span>
                    </MobileMenuItem>
                </div>

                {/* 刷新(软刷新：仅 location.reload，不清 SW 缓存) + 重启(清缓存硬刷新)
                    并排成行：两者都是页面级重载动作，语义同组，对照主题/语言那行的双栏布局。
                    仅 PWA 展示：浏览器有自带刷新按钮，PWA(standalone)无浏览器 chrome 才需要 */}
                {isPwa && (
                    <div style={{ display: 'flex', alignItems: 'stretch' }}>
                        <MobileMenuItem
                            $active={false}
                            $token={token}
                            style={{ flex: 1 }}
                            onClick={() => {
                                handleClose()
                                // Android Chrome PWA standalone：同步 window.location.reload() 紧随
                                // setMobileMenuOpen 这个 setState 会被吞掉——drawer 关了但页面不重载。
                                // 延到下一 task,让 React 先 flush 完 drawer 关闭态再触发导航。
                                // 对齐「重启」的异步 reload 路径(其 reload 在 Modal 确认 + await 后才触发)。
                                setTimeout(() => window.location.reload(), 0)
                            }}
                        >
                            <RotateCw size={20} />
                            <span>{t('nav.refresh')}</span>
                        </MobileMenuItem>
                        <div style={{ width: 1, alignSelf: 'stretch', background: token.colorBorder, margin: '8px 0' }} />
                        <MobileMenuItem
                            $active={false}
                            $token={token}
                            style={{ flex: 1 }}
                            onClick={() => {
                                handleClose()
                                restart()
                            }}
                        >
                            <RefreshCw size={20} />
                            <span>{t('nav.restart')}</span>
                        </MobileMenuItem>
                    </div>
                )}

                <MobileMenuItem
                    $active={false}
                    $danger={true}
                    $token={token}
                    onClick={() => {
                        handleLogout()
                    }}
                >
                    <logoutNavItem.icon size={20} />
                    <span>{t(logoutNavItem.labelKey)}</span>
                </MobileMenuItem>
            </MenuContent>
        </MobileDrawer>
    )
}
