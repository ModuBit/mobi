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

import { useState, useCallback } from 'react'
import { App, Button, Form, Input, Layout, Select, Spin, Typography, theme as antTheme, Card } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeftOutlined, FolderOutlined } from '@ant-design/icons'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSpawnSession, type SpawnInput } from '@/hooks/mutations/useSpawnSession'
import { PageHeader } from '@/components/layout/PageHeader'
import styled from '@emotion/styled'

const { Title, Text } = Typography
const { useToken } = antTheme

const PageContent = styled.div`
    flex: 1;
    overflow: auto;
    padding: 24px;
    display: flex;
    justify-content: center;
`

const FormCard = styled(Card)`
    max-width: 600px;
    width: 100%;
`

const FormActions = styled.div`
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
`

/**
 * 新建会话页面
 * 允许用户选择机器、目录和配置来创建新的 Claude Code 会话
 */
export function NewSessionPage() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const [form] = Form.useForm()
    const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null)
    const [directory, setDirectory] = useState('')
    const { message } = App.useApp()

    const { machines, isLoading: isLoadingMachines } = useMachines()
    const { spawnSession, isPending } = useSpawnSession()

    // 活跃的机器列表
    const activeMachines = machines.filter(m => m.active)

    // 处理提交
    const handleSubmit = useCallback(async (values: {
        machineId: string
        directory: string
        agent?: string
        model?: string
        yolo?: boolean
        sessionType?: 'simple' | 'worktree'
        worktreeName?: string
    }) => {
        const input: SpawnInput = {
            machineId: values.machineId,
            directory: values.directory,
            agent: values.agent as SpawnInput['agent'],
            model: values.model,
            yolo: values.yolo,
            sessionType: values.sessionType,
            worktreeName: values.worktreeName,
        }

        const result = await spawnSession(input)

        if (result.type === 'success' && result.sessionId) {
            message.success(t('common.success'))
            navigate({ to: '/sessions/$sessionId', params: { sessionId: result.sessionId } })
        } else if (result.type === 'error') {
            message.error(result.message || t('common.error'))
        }
    }, [spawnSession, navigate, t])

    // 返回上一页
    const handleBack = useCallback(() => {
        navigate({ to: '/sessions' })
    }, [navigate])

    return (
        <Layout style={{ height: '100%' }}>
            {/* 页面头部 */}
            <PageHeader
                left={
                    <>
                        <Button
                            icon={<ArrowLeftOutlined />}
                            type="text"
                            onClick={handleBack}
                        />
                        <Title level={4} style={{ margin: 0 }}>
                            {t('home.newSession')}
                        </Title>
                    </>
                }
            />

            {/* 表单内容 */}
            <Layout.Content>
                <PageContent>
                <FormCard>
                    {isLoadingMachines ? (
                        <div style={{ textAlign: 'center', padding: '40px 0' }}>
                            <Spin />
                        </div>
                    ) : (
                        <Form
                            form={form}
                            layout="vertical"
                            onFinish={handleSubmit}
                            initialValues={{
                                agent: 'claude',
                                sessionType: 'simple',
                            }}
                        >
                            {/* 机器选择 */}
                            <Form.Item
                                name="machineId"
                                label="Machine"
                                rules={[{ required: true, message: 'Please select a machine' }]}
                            >
                                <Select
                                    placeholder="Select a machine"
                                    onChange={(value) => setSelectedMachineId(value)}
                                    options={activeMachines.map(m => ({
                                        label: m.metadata?.displayName || m.metadata?.host || m.id,
                                        value: m.id,
                                    }))}
                                />
                            </Form.Item>

                            {/* 工作目录 */}
                            <Form.Item
                                name="directory"
                                label="Working Directory"
                                rules={[{ required: true, message: 'Please enter a directory path' }]}
                            >
                                <Input
                                    prefix={<FolderOutlined />}
                                    placeholder="/path/to/project"
                                    value={directory}
                                    onChange={(e) => setDirectory(e.target.value)}
                                />
                            </Form.Item>

                            {/* Agent 类型 */}
                            <Form.Item
                                name="agent"
                                label="Agent"
                                initialValue="claude"
                            >
                                <Select
                                    options={[
                                        { label: 'Claude Code', value: 'claude' },
                                    ]}
                                />
                            </Form.Item>

                            {/* 模型选择 */}
                            <Form.Item
                                name="model"
                                label="Model (Optional)"
                            >
                                <Select
                                    allowClear
                                    placeholder="Use default model"
                                    options={[
                                        { label: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
                                        { label: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
                                        { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
                                    ]}
                                />
                            </Form.Item>

                            {/* 会话类型 */}
                            <Form.Item
                                name="sessionType"
                                label="Session Type"
                            >
                                <Select
                                    options={[
                                        { label: 'Simple', value: 'simple' },
                                        { label: 'Worktree', value: 'worktree' },
                                    ]}
                                />
                            </Form.Item>

                            {/* Worktree 名称（仅 worktree 类型时显示） */}
                            <Form.Item
                                noStyle
                                shouldUpdate={(prev, curr) => prev.sessionType !== curr.sessionType}
                            >
                                {({ getFieldValue }) => {
                                    const sessionType = getFieldValue('sessionType')
                                    if (sessionType !== 'worktree') return null
                                    return (
                                        <Form.Item
                                            name="worktreeName"
                                            label="Worktree Name"
                                        >
                                            <Input placeholder="feature-branch" />
                                        </Form.Item>
                                    )
                                }}
                            </Form.Item>

                            {/* YOLO 模式 */}
                            <Form.Item
                                name="yolo"
                                label="YOLO Mode"
                                valuePropName="checked"
                            >
                                <Select
                                    options={[
                                        { label: 'Disabled', value: false },
                                        { label: 'Enabled (Bypass Permissions)', value: true },
                                    ]}
                                />
                            </Form.Item>

                            {/* 操作按钮 */}
                            <FormActions>
                                <Button onClick={handleBack}>
                                    {t('common.cancel')}
                                </Button>
                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    loading={isPending}
                                >
                                    {t('home.newSession')}
                                </Button>
                            </FormActions>
                        </Form>
                    )}
                </FormCard>
            </PageContent>
            </Layout.Content>
        </Layout>
    )
}
