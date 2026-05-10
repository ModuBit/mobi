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

import { Form, Input, Button, Typography, Space, App, ConfigProvider, theme as antTheme } from 'antd'
import { SunOutlined, MoonOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useUiStore } from '@/core/data/stores/uiStore'
import { Helmet } from 'react-helmet-async'
import axios from 'axios'
import { useState } from 'react'
import styled from '@emotion/styled'
import { ParticleCanvas } from '@/components/ui/ParticleCanvas'
import { shadcnDarkToken } from '@/core/config/theme/tokens'
import { shadcnDarkComponents } from '@/core/config/theme/components'

const { Title, Text } = Typography

/** 登录页面全屏容器 */
const PageContainer = styled.div`
    position: relative;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
`

/** 右上角固定按钮组 */
const TopActions = styled.div`
    position: fixed;
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
    background: rgba(255, 255, 255, 0.85);
    color: #18181b;
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
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: rgba(255, 255, 255, 0.45);
`

/** 表单容器：极轻的深色衬底，保证可读性 */
const LoginForm = styled.div`
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 340px;
    padding: 32px 28px;
    background: rgba(0, 0, 0, 0.35);
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);

    .ant-input-affix-wrapper {
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 8px;

        &:hover {
            border-color: rgba(255, 255, 255, 0.45);
        }

        &-focused {
            border-color: rgba(255, 255, 255, 0.6);
            box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.08);
        }

        input {
            background: transparent;
            color: rgba(255, 255, 255, 0.9);

            &::placeholder {
                color: rgba(255, 255, 255, 0.55);
            }
        }

        .ant-input-suffix {
            color: rgba(255, 255, 255, 0.5);
        }
    }

    .ant-btn-primary {
        height: 40px;
        border-radius: 8px;
        font-weight: 500;
        letter-spacing: 0.02em;
    }
`

/** 标题区域 */
const Header = styled.div`
    text-align: center;
    margin-bottom: 28px;
`

/** 副标题 */
const Subtitle = styled(Text)`
    display: block;
    margin-top: 8px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.65);
`

export function LoginPage() {
    const navigate = useNavigate()
    const { setToken } = useAuthStore()
    const [form] = Form.useForm()
    const [loading, setLoading] = useState(false)
    const { theme, setTheme, locale, setLocale } = useUiStore()
    const { message } = App.useApp()

    const handleToggleTheme = () => {
        setTheme(theme === 'dark' ? 'light' : 'dark')
    }

    const handleToggleLocale = () => {
        setLocale(locale === 'zh' ? 'en' : 'zh')
    }
    const { t } = useTranslation()

    const baseUrl = window.location.origin

    const handleSubmit = async (values: { token: string }) => {
        setLoading(true)
        try {
            const authRes = await axios.post(`${baseUrl}/api/auth`, {
                accessToken: values.token
            })

            if (!authRes.data?.token) {
                throw new Error('认证失败：未返回 JWT Token')
            }

            setToken(authRes.data.token)
            message.success(t('login.connectSuccess'))
            navigate({ to: '/' })
        } catch (err) {
            console.error('Login error:', err)
            if (axios.isAxiosError(err) && err.response?.data?.error) {
                message.error(`${t('login.authFailed')}：${err.response.data.error}`)
            } else {
                message.error(t('login.authFailed'))
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <ConfigProvider theme={{ algorithm: antTheme.darkAlgorithm, token: shadcnDarkToken, components: shadcnDarkComponents }}>
            <Helmet>
                <title>{t('siteTitle')}</title>
            </Helmet>
            <PageContainer>
                <ParticleCanvas
                    imageUrl="/logo.svg"
                    style={{ position: 'absolute', inset: 0, zIndex: 0 }}
                />
                <TopActions>
                    <Button
                        type="text"
                        onClick={handleToggleLocale}
                        title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
                        style={{ padding: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
                        icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                        onClick={handleToggleTheme}
                    />
                </TopActions>
                <LoginForm>
                    <Space orientation="vertical" style={{ width: '100%' }} size="large">
                        <Header>
                            <Title level={2} style={{ marginBottom: 0, fontWeight: 600, letterSpacing: '-0.02em' }}>
                                {t('login.title')}
                            </Title>
                            <Subtitle>{t('login.subtitle')}</Subtitle>
                        </Header>
                        <Form
                            form={form}
                            layout="vertical"
                            onFinish={handleSubmit}
                        >
                            <Form.Item
                                name="token"
                                rules={[{ required: true, message: t('login.tokenRequired') }]}
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
                    </Space>
                </LoginForm>
            </PageContainer>
        </ConfigProvider>
    )
}
