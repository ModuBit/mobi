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

import { Form, Input, Button, App } from 'antd'
import {
    SunOutlined,
    MoonOutlined,
    GithubOutlined,
    EyeOutlined,
    EyeInvisibleOutlined,
} from '@ant-design/icons'
import { BootLogPanel } from '@/components/login/BootLogPanel'
import { shadcnLightToken, shadcnDarkToken } from '@/core/config/theme/tokens'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useThemeLocaleToggle } from '@/components/layout/useThemeLocaleToggle'
import { Logo } from '@/components/layout/Logo'
import { MobiLogo } from '@/components/ui/MobiLogo'
import { MobiWordmark } from '@/components/layout/MobiWordmark'
import { Helmet } from 'react-helmet-async'
import axios from 'axios'
import { useState } from 'react'
import styled from '@emotion/styled'

/** 全屏容器：左右分栏（固定视口高度，左右各自处理内部滚动） */
const PageContainer = styled.div`
    display: flex;
    width: 100%;
    height: 100dvh;
    overflow: hidden;
`

/** Logo 图片 */
const LogoImg = styled.div`
    width: 32px;
    height: 32px;
    flex-shrink: 0;
`

/** 品牌名（仅承载 color，字标尺寸由 MobiWordmark 自身控制） */
const BrandName = styled.span`
    color: #141413;

    html[data-theme='dark'] & {
        color: #faf9f5;
    }
`

/** 右面板：登录表单 */
const LoginPanel = styled.div`
    display: flex;
    align-items: safe center;
    justify-content: center;
    width: 100%;
    /* 底部避让 home 指示条；桌面 env=0 保持 32px */
    padding: 32px 32px max(32px, env(safe-area-inset-bottom));
    position: relative;
    background: #faf9f5;
    /* 矮视口表单超高时自滚（safe center：溢出回退顶部不切割） */
    overflow-y: auto;

    html[data-theme='dark'] & {
        background: #141413;
    }

    @media (min-width: 1024px) {
        width: 50%;
    }
`

/** 右上角操作按钮 */
const TopActions = styled.div`
    position: absolute;
    /* 避让刘海/圆角；桌面 env=0 保持 16px */
    top: max(16px, env(safe-area-inset-top));
    right: max(16px, env(safe-area-inset-right));
    display: flex;
    gap: 8px;
    z-index: 2;
`

/** 语言切换图标 */
const LocaleSwitchIcon = styled.div`
    position: relative;
    width: 24px;
    height: 20px;
`

const ActiveLocale = styled.span`
    position: absolute;
    top: 0;
    left: 0;
    font-size: 10px;
    font-weight: 600;
    line-height: 14px;
    z-index: 2;
    padding: 0 3px;
    border-radius: 3px;
    background: rgba(20, 20, 19, 0.9);
    color: #faf9f5;

    html[data-theme='dark'] & {
        background: rgba(250, 249, 245, 0.85);
        color: #141413;
    }
`

const InactiveLocale = styled.span`
    position: absolute;
    bottom: 0;
    right: 0;
    font-size: 9px;
    font-weight: 400;
    line-height: 12px;
    z-index: 1;
    padding: 0 2px;
    border-radius: 2px;
    background: transparent;
    border: 1px solid rgba(20, 20, 19, 0.2);
    color: rgba(20, 20, 19, 0.4);

    html[data-theme='dark'] & {
        border-color: rgba(250, 249, 245, 0.25);
        color: rgba(250, 249, 245, 0.45);
    }
`

/** 移动端 Logo */
const MobileLogo = styled.div`
    position: absolute;
    /* 避让刘海/圆角；桌面 env=0 保持 16px */
    top: max(16px, env(safe-area-inset-top));
    left: max(16px, env(safe-area-inset-left));
    display: flex;
    align-items: center;
    gap: 8px;

    @media (min-width: 1024px) {
        display: none;
    }
`

/** 表单区域：圆角容器（与整体同色背景） */
const FormArea = styled.div`
    position: relative;
    z-index: 10;
    width: 100%;
    max-width: 380px;
    padding: 32px;
    border-radius: 16px;
    background: ${shadcnLightToken.colorBgBase};

    html[data-theme='dark'] & {
        background: ${shadcnDarkToken.colorBgBase};
    }
`

/** 欢迎标题 */
const WelcomeTitle = styled.h1`
    font-size: 24px;
    font-weight: 500;
    letter-spacing: -0.02em;
    margin: 0 0 8px;
    text-align: center;
    color: #141413;

    html[data-theme='dark'] & {
        color: #faf9f5;
    }
`

/** 品牌 Logo（表单区域，入场打招呼播一轮：MobiLogo play=once） */
const AnimatedLogoWrap = styled(MobiLogo)`
    display: block;
    width: 64px;
    height: 64px;
    margin: 0 auto 16px;
`

/** 欢迎副标题 */
const WelcomeSubtitle = styled.p`
    font-size: 14px;
    margin: 0;
    text-align: center;
    color: #b0aea5;

    html[data-theme='dark'] & {
        color: #87867f;
    }
`

/** 帮助链接：流式居中显示 */
const HelpLink = styled.a`
    margin-top: 24px;
    justify-content: center;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
    color: #b0aea5;
    text-decoration: none;
    transition: color 0.2s;

    html[data-theme='dark'] & {
        color: #5e5d59;
    }

    &:hover {
        color: #87867f;

        html[data-theme='dark'] & {
            color: #87867f;
        }
    }
`

export function LoginPage() {
    const navigate = useNavigate()
    const { setAuthenticated } = useAuthStore()
    const [form] = Form.useForm()
    const [loading, setLoading] = useState(false)
    const { resolvedTheme, locale, toggleTheme, toggleLocale } =
        useThemeLocaleToggle()
    const isDark = resolvedTheme === 'dark'
    const { message } = App.useApp()
    const { t } = useTranslation()

    const baseUrl = window.location.origin

    const handleSubmit = async (values: { token: string }) => {
        setLoading(true)
        try {
            const authRes = await axios.post(
                `${baseUrl}/api/auth`,
                {
                    accessToken: values.token,
                },
                {
                    withCredentials: true, // 让 Set-Cookie（httpOnly）写入浏览器
                },
            )

            if (authRes.status !== 200) {
                throw new Error('认证失败')
            }

            // 置 authenticated（驱动路由/SSE/socket.io terminal）；登录态真源是 httpOnly cookie
            setAuthenticated(true)
            message.success(t('login.connectSuccess'))
            navigate({ to: '/' })
        } catch (err) {
            console.error('Login error:', err)
            if (axios.isAxiosError(err) && err.response?.data?.error) {
                message.error(
                    `${t('login.authFailed')}：${err.response.data.error}`,
                )
            } else {
                message.error(t('login.authFailed'))
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <PageContainer>
            <Helmet>
                <title>{t('siteTitle')}</title>
            </Helmet>

            <BootLogPanel />

            <LoginPanel>
                <MobileLogo>
                    <LogoImg as={Logo} style={{ width: 24, height: 24 }} />
                    <BrandName>
                        <MobiWordmark size={18} />
                    </BrandName>
                </MobileLogo>

                <TopActions>
                    <Button
                        type="text"
                        onClick={toggleLocale}
                        title={
                            locale === 'zh'
                                ? 'Switch to English'
                                : '切换到中文'
                        }
                        style={{
                            padding: 0,
                            width: 32,
                            height: 32,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <LocaleSwitchIcon>
                            <ActiveLocale>
                                {locale === 'zh' ? '中' : 'En'}
                            </ActiveLocale>
                            <InactiveLocale>
                                {locale === 'zh' ? 'En' : '中'}
                            </InactiveLocale>
                        </LocaleSwitchIcon>
                    </Button>
                    <Button
                        shape="circle"
                        type="text"
                        icon={isDark ? <SunOutlined /> : <MoonOutlined />}
                        onClick={toggleTheme}
                    />
                </TopActions>

                <FormArea>
                    <div style={{ marginBottom: 32 }}>
                        <AnimatedLogoWrap play="once" />
                        <WelcomeTitle>{t('login.welcome')}</WelcomeTitle>
                        <WelcomeSubtitle>
                            {t('login.welcomeSubtitle')}
                        </WelcomeSubtitle>
                    </div>

                    <Form
                        form={form}
                        layout="vertical"
                        onFinish={handleSubmit}
                    >
                        <Form.Item
                            name="token"
                            rules={[
                                {
                                    required: true,
                                    message: t('login.tokenRequired'),
                                },
                            ]}
                        >
                            <Input.Password
                                autoComplete="current-password"
                                placeholder={t('login.tokenPlaceholder')}
                                size="large"
                                visibilityToggle
                                iconRender={(visible) => (
                                    // onMouseDown 防止点击切换按钮时 input 失焦
                                    <span
                                        onMouseDown={(e) => e.preventDefault()}
                                        style={{ display: 'inline-flex' }}
                                    >
                                        {visible ? (
                                            <EyeInvisibleOutlined />
                                        ) : (
                                            <EyeOutlined />
                                        )}
                                    </span>
                                )}
                            />
                        </Form.Item>
                        <Form.Item style={{ marginBottom: 0 }}>
                            <Button
                                type="primary"
                                htmlType="submit"
                                block
                                size="large"
                                loading={loading}
                            >
                                {t('login.connect')}
                            </Button>
                        </Form.Item>
                    </Form>

                    <HelpLink
                        href="https://github.com/modubit/mobi"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <GithubOutlined style={{ fontSize: 14 }} />
                        GitHub
                    </HelpLink>
                </FormArea>
            </LoginPanel>
        </PageContainer>
    )
}
