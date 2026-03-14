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

import { Form, Input, Button, Card, Typography, Space, message, theme as antTheme } from 'antd'
import { SunOutlined, MoonOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'
import axios from 'axios'
import { useState } from 'react'

const { Title, Paragraph } = Typography
const { useToken } = antTheme

export function LoginPage() {
    const navigate = useNavigate()
    const { setToken } = useAuthStore()
    const [form] = Form.useForm()
    const [loading, setLoading] = useState(false)
    const { token } = useToken()
    const { theme, toggleTheme, locale, toggleLocale } = useUiStore()
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
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: token.colorBgLayout,
            padding: '16px',
        }}>
            {/* 右上角按钮组：语言 + 主题 */}
            <div style={{ position: 'fixed', top: 16, right: 16, display: 'flex', gap: 8 }}>
                <Button
                    type="text"
                    onClick={toggleLocale}
                    title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
                    style={{ padding: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    {/* Ant Design 官网风格的语言切换按钮 */}
                    <div style={{
                        position: 'relative',
                        width: 24,
                        height: 20,
                    }}>
                        {/* 当前语言 - 左上，有背景填充 */}
                        <span style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            fontSize: 10,
                            fontWeight: 600,
                            lineHeight: '14px',
                            zIndex: 2,
                            padding: '0 3px',
                            borderRadius: 3,
                            background: theme === 'dark' ? '#d8d8d8' : '#18181b',
                            color: theme === 'dark' ? '#18181b' : '#ffffff',
                        }}>
                            {locale === 'zh' ? '中' : 'En'}
                        </span>
                        {/* 待切换语言 - 右下，背景透明，有 border */}
                        <span style={{
                            position: 'absolute',
                            bottom: 0,
                            right: 0,
                            fontSize: 9,
                            fontWeight: 400,
                            lineHeight: '12px',
                            zIndex: 1,
                            padding: '0 2px',
                            borderRadius: 2,
                            background: 'transparent',
                            border: `1px solid ${theme === 'dark' ? '#52525b' : '#d4d4d8'}`,
                            color: token.colorTextTertiary,
                        }}>
                            {locale === 'zh' ? 'En' : '中'}
                        </span>
                    </div>
                </Button>
                <Button
                    shape="circle"
                    type="text"
                    icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                    onClick={toggleTheme}
                />
            </div>
            <Card
                style={{ width: '100%', maxWidth: 400, background: 'transparent', border: 'none', boxShadow: 'none' }}
                styles={{ body: { background: 'transparent' } }}
            >
                <Space direction="vertical" style={{ width: '100%' }} size="large">
                    <div style={{ textAlign: 'center' }}>
                        <Title level={2} style={{ marginBottom: 4 }}>{t('login.title')}</Title>
                        <Paragraph type="secondary">
                            {t('login.subtitle')}
                        </Paragraph>
                    </div>
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
            </Card>
        </div>
    )
}
