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

import { Form, Input, Button, Card, Typography, Space, App, theme as antTheme } from 'antd'
import { SunOutlined, MoonOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'
import { Helmet } from 'react-helmet-async'
import axios from 'axios'
import { useState } from 'react'
import styled from '@emotion/styled'

const { Title, Paragraph } = Typography
const { useToken } = antTheme

/** 登录页面全屏居中容器 */
const PageContainer = styled.div<{ $bgColor: string }>`
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${props => props.$bgColor};
    padding: 16px;
`

/** 右上角固定按钮组容器 */
const TopActions = styled.div`
    position: fixed;
    top: 16px;
    right: 16px;
    display: flex;
    gap: 8px;
`

/** 主题切换按钮容器 */
const LocaleSwitchIcon = styled.div`
    position: relative;
    width: 24px;
    height: 20px;
`

/** 当前语言标签（左上角，有背景填充） */
const ActiveLocale = styled.span<{ $isDark: boolean }>`
    position: absolute;
    top: 0;
    left: 0;
    font-size: 10px;
    font-weight: 600;
    line-height: 14px;
    z-index: 2;
    padding: 0 3px;
    border-radius: 3px;
    background: ${props => props.$isDark ? '#d8d8d8' : '#18181b'};
    color: ${props => props.$isDark ? '#18181b' : '#ffffff'};
`

/** 待切换语言标签（右下角，透明背景，有 border） */
const InactiveLocale = styled.span<{ $isDark: boolean; $textColor: string }>`
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
    border: 1px solid ${props => props.$isDark ? '#52525b' : '#d4d4d8'};
    color: ${props => props.$textColor};
`

/** 标题居中区域 */
const TitleArea = styled.div`
    text-align: center;
`

/** 登录卡片透明样式 */
const TransparentCard = styled(Card)`
    width: 100%;
    max-width: 400px;
    background: transparent;
    border: none;
    box-shadow: none;

    .ant-card-body {
        background: transparent;
    }
`

export function LoginPage() {
    const navigate = useNavigate()
    const { setToken } = useAuthStore()
    const [form] = Form.useForm()
    const [loading, setLoading] = useState(false)
    const { token } = useToken()
    const { theme, setTheme, locale, setLocale } = useUiStore()
    const { message } = App.useApp()

    // 主题切换（在 light 和 dark 之间切换）
    const handleToggleTheme = () => {
        setTheme(theme === 'dark' ? 'light' : 'dark')
    }

    // 语言切换
    const handleToggleLocale = () => {
        setLocale(locale === 'zh' ? 'en' : 'zh')
    }
    const { t } = useTranslation()

    // baseUrl 就是当前页面的 origin（Hub 服务器）
    const baseUrl = window.location.origin

    const handleSubmit = async (values: { token: string }) => {
        setLoading(true)
        try {
            // 用 CLI API Token 换取 JWT Token
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
        <>
            <Helmet>
                <title>{t('siteTitle')}</title>
            </Helmet>
            <PageContainer $bgColor={token.colorBgLayout}>
            {/* 右上角按钮组：语言 + 主题 */}
            <TopActions>
                <Button
                    type="text"
                    onClick={handleToggleLocale}
                    title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
                    style={{ padding: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    {/* Ant Design 官网风格的语言切换按钮 */}
                    <LocaleSwitchIcon>
                        <ActiveLocale $isDark={theme === 'dark'}>
                            {locale === 'zh' ? '中' : 'En'}
                        </ActiveLocale>
                        <InactiveLocale $isDark={theme === 'dark'} $textColor={token.colorTextTertiary}>
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
            <TransparentCard>
                <Space orientation="vertical" style={{ width: '100%' }} size="large">
                    <TitleArea>
                        <Title level={2} style={{ marginBottom: 4 }}>{t('login.title')}</Title>
                        <Paragraph type="secondary">
                            {t('login.subtitle')}
                        </Paragraph>
                    </TitleArea>
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
                        <Form.Item>
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
            </TransparentCard>
        </PageContainer>
        </>
    )
}
