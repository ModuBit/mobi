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
import { SunOutlined, MoonOutlined, GithubOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useThemeLocaleToggle } from '@/components/layout/useThemeLocaleToggle'
import { Logo } from '@/components/layout/Logo'
import { AnimateLogo } from '@/components/layout/AnimateLogo'
import { IntroLogo } from '@/components/layout/IntroLogo'
import { Helmet } from 'react-helmet-async'
import axios from 'axios'
import { useState } from 'react'
import styled from '@emotion/styled'

const CURRENT_YEAR = new Date().getFullYear()

const FEATURES = [
    { titleKey: 'feature1Title', descKey: 'feature1Desc' },
    { titleKey: 'feature2Title', descKey: 'feature2Desc' },
    { titleKey: 'feature3Title', descKey: 'feature3Desc' },
] as const

/** 全屏容器：左右分栏 */
const PageContainer = styled.div`
    display: flex;
    width: 100%;
    min-height: 100dvh;
`

/**
 * 左面板：品牌展示（仅 PC 端可见）
 * 通过 html[data-theme] 选择器适配 dark/light 主题
 */
const BrandPanel = styled.div`
    display: none;

    @media (min-width: 1024px) {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        width: 50%;
        padding: 48px;
        position: relative;
        overflow: hidden;
        background: #faf9f5;
        border-right: 1px solid #f0eee6;

        html[data-theme='dark'] & {
            background: #141413;
            border-right-color: #30302e;
        }
    }
`

/** 网格纹理 */
const GridPattern = styled.div`
    position: absolute;
    inset: 0;
    opacity: 0.03;
    pointer-events: none;
    background-image: linear-gradient(#000 1px, transparent 1px),
        linear-gradient(90deg, #000 1px, transparent 1px);
    background-size: 60px 60px;

    html[data-theme='dark'] & {
        background-image: linear-gradient(#fff 1px, transparent 1px),
            linear-gradient(90deg, #fff 1px, transparent 1px);
    }
`

/** 装饰光晕 */
const GlowOrb = styled.div`
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
    filter: blur(100px);
    background: radial-gradient(circle, rgba(232, 230, 220, 0.4), transparent);

    html[data-theme='dark'] & {
        background: radial-gradient(
            circle,
            rgba(48, 48, 46, 0.3),
            transparent
        );
    }
`

/** Logo 图片 */
const LogoImg = styled.div`
    width: 32px;
    height: 32px;
    flex-shrink: 0;
`

/** 品牌名 */
const BrandName = styled.span`
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.03em;
    color: #141413;

    html[data-theme='dark'] & {
        color: #faf9f5;
    }
`

/** 品牌标语 */
const Tagline = styled.h2`
    font-size: 20px;
    font-weight: 400;
    line-height: 1.6;
    letter-spacing: -0.01em;
    color: #87867f;
    margin: 0;

    html[data-theme='dark'] & {
        color: #d1cfc5;
    }
`

/** 品牌描述 */
const Description = styled.p`
    font-size: 14px;
    line-height: 1.7;
    color: #87867f;
    margin: 16px 0 0;

    html[data-theme='dark'] & {
        color: #b0aea5;
    }
`

/** 特性列表 */
const FeatureList = styled.div`
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 32px;
`

/** 特性项 */
const FeatureItem = styled.div`
    display: flex;
    align-items: flex-start;
    gap: 12px;

    .feature-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #141413;
        margin-top: 7px;
        flex-shrink: 0;

        html[data-theme='dark'] & {
            background: #faf9f5;
        }
    }

    .feature-title {
        font-size: 13px;
        font-weight: 500;
        color: #4d4c48;

        html[data-theme='dark'] & {
            color: #d1cfc5;
        }
    }

    .feature-desc {
        font-size: 12px;
        color: #b0aea5;
        margin-top: 2px;

        html[data-theme='dark'] & {
            color: #87867f;
        }
    }
`

/** 底部版权 */
const FooterMeta = styled.div`
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #b0aea5;

    html[data-theme='dark'] & {
        color: #5e5d59;
    }
`

/** 右面板：登录表单 */
const LoginPanel = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 32px;
    position: relative;
    background: #faf9f5;

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
    top: 16px;
    right: 16px;
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
    top: 16px;
    left: 16px;
    display: flex;
    align-items: center;
    gap: 8px;

    @media (min-width: 1024px) {
        display: none;
    }
`

/** 表单区域 */
const FormArea = styled.div`
    width: 100%;
    max-width: 380px;
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

/** 动画 Logo（表单区域） */
const AnimatedLogoWrap = styled(AnimateLogo)`
    display: block;
    width: 64px;
    height: 64px;
    margin: 0 auto 16px;
    color: #141413;

    html[data-theme='dark'] & {
        color: #faf9f5;
    }
`

/** 开场动画 Logo（品牌区域） */
const IntroLogoWrap = styled(IntroLogo)`
    margin-bottom: 64px;
    margin-left: -32px;
    color: #141413;

    html[data-theme='dark'] & {
        color: #faf9f5;
    }
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

/** 帮助链接 */
const HelpLink = styled.a`
    position: absolute;
    bottom: 32px;
    right: 32px;
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

    @media (max-width: 1023px) {
        position: absolute;
        bottom: 32px;
        right: auto;
        left: 50%;
        transform: translateX(-50%);
    }
`

export function LoginPage() {
    const navigate = useNavigate()
    const { setAuthenticated } = useAuthStore()
    const [form] = Form.useForm()
    const [loading, setLoading] = useState(false)
    const { resolvedTheme, locale, toggleTheme, toggleLocale } = useThemeLocaleToggle()
    const isDark = resolvedTheme === 'dark'
    const { message } = App.useApp()
    const { t } = useTranslation()

    const baseUrl = window.location.origin

    const handleSubmit = async (values: { token: string }) => {
        setLoading(true)
        try {
            const authRes = await axios.post(`${baseUrl}/api/auth`, {
                accessToken: values.token,
            }, {
                withCredentials: true, // 让 Set-Cookie（httpOnly）写入浏览器
            })

            if (!authRes.data?.token) {
                throw new Error('认证失败：未返回 JWT Token')
            }

            // 置 authenticated（驱动路由/SSE）；token 存内存供 socket.io terminal 使用
            setAuthenticated(authRes.data.token)
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

            <BrandPanel>
                <GridPattern />
                <GlowOrb
                    style={{
                        top: '-20%',
                        left: '-20%',
                        width: '80%',
                        height: '80%',
                    }}
                />
                <GlowOrb
                    style={{
                        bottom: '-10%',
                        right: '-10%',
                        width: '60%',
                        height: '60%',
                    }}
                />

                <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <LogoImg as={Logo} />
                    <BrandName>{t('login.brand')}</BrandName>
                </div>

                <div
                    style={{
                        position: 'relative',
                        zIndex: 1,
                        maxWidth: 480,
                    }}
                >
                    <IntroLogoWrap />
                    <Tagline>{t('login.subtitle')}</Tagline>
                    <Description>{t('login.description')}</Description>
                    <FeatureList>
                        {FEATURES.map(({ titleKey, descKey }) => (
                            <FeatureItem key={titleKey}>
                                <div className="feature-dot" />
                                <div>
                                    <div className="feature-title">
                                        {t(`login.${titleKey}`)}
                                    </div>
                                    <div className="feature-desc">
                                        {t(`login.${descKey}`)}
                                    </div>
                                </div>
                            </FeatureItem>
                        ))}
                    </FeatureList>
                </div>

                <div style={{ position: 'relative', zIndex: 1 }}>
                    <FooterMeta>© {CURRENT_YEAR} Mobi</FooterMeta>
                </div>
            </BrandPanel>

            <LoginPanel>
                <MobileLogo>
                    <LogoImg as={Logo} style={{ width: 24, height: 24 }} />
                    <BrandName>{t('login.brand')}</BrandName>
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
                        <AnimatedLogoWrap />
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
                                placeholder={t('login.tokenPlaceholder')}
                                size="large"
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
                </FormArea>

                <HelpLink
                    href="https://github.com/modubit/mobi"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <GithubOutlined style={{ fontSize: 14 }} />
                    GitHub
                </HelpLink>
            </LoginPanel>
        </PageContainer>
    )
}
