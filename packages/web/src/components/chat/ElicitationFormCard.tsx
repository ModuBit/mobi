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

import { useMemo } from 'react'
import { Button, Form, Input, InputNumber, Select, Switch, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import type { PermissionAnswers, SDKUIHints } from '@mobi/shared'
import type { ElicitationFieldSchema, ElicitationRequestedSchema } from '@/domain/tool/elicitation'

const { useToken } = antTheme

export type ElicitationFormCardProps = {
    /** agentState.requests 的条目 id（提交/拒绝回传定位用，本组件不直接发请求） */
    requestId: string
    /** MCP server 名（头部展示） */
    serverName: string
    /** server 的 elicitation 请求正文 */
    message: string
    /** MCP elicitation requestedSchema（spec D4：string/number/boolean/enum 四类映射） */
    requestedSchema: ElicitationRequestedSchema | null
    /** SDK UI 提示（title/displayName/description 有则渲染） */
    sdkHints?: SDKUIHints
    /** 提交：answers 经既有审批 approve 链路回传 cli（answers 值已含原生 number/boolean，spec D3） */
    onSubmit: (answers: PermissionAnswers) => void
    /** 拒绝（reason 可选，当前 UI 不收集原因，预留接口） */
    onDecline: (reason?: string) => void
    /** 外部禁用（会话非运行态等） */
    disabled?: boolean
}

/**
 * 按 requestedSchema 单字段生成表单控件（spec D4：string→Input、enum→Select、
 * number→InputNumber、boolean→Switch；嵌套对象/数组 cli 端已 decline 兜底，此处不处理）
 */
function renderFieldControl(field: ElicitationFieldSchema) {
    if (field.enum && field.enum.length > 0) {
        return (
            <Select
                options={field.enum.map((value) => ({ value, label: value }))}
                allowClear
                style={{ width: '100%' }}
            />
        )
    }
    switch (field.type) {
        case 'number':
            return <InputNumber style={{ width: '100%' }} />
        case 'boolean':
            // Switch 的表单值走 checked（antd 约定），保证 onFinish 收到原生 boolean
            return <Switch />
        case 'string':
        default:
            return <Input />
    }
}

/**
 * MCP elicitation 表单卡片（批次 C，spec D4）。
 * 从 agentState.requests 的 mcp_elicitation 条目渲染表单；提交/拒绝由父组件接既有审批
 * 提交 API——已决即随条目从 requests 消失而卸载（spec D5），本组件不维护「已提交」本地态。
 */
export function ElicitationFormCard({
    requestId,
    serverName,
    message,
    requestedSchema,
    sdkHints,
    onSubmit,
    onDecline,
    disabled = false,
}: ElicitationFormCardProps) {
    const { t } = useTranslation()
    const { token } = useToken()

    // 字段清单一次解析（按 properties 声明序渲染；required 做前端必填校验）
    const fields = useMemo(() => {
        const properties = requestedSchema?.properties ?? {}
        const required = new Set(requestedSchema?.required ?? [])
        return Object.entries(properties).map(([name, field]) => ({
            name,
            field,
            required: required.has(name),
        }))
    }, [requestedSchema])

    const handleSubmit = (values: Record<string, unknown>) => {
        // 可选字段留空不回传（undefined/null/'' 剔除）；false/0 是合法 elicitation 值，保留
        const answers: Record<string, string | number | boolean | string[]> = {}
        for (const [key, value] of Object.entries(values)) {
            if (value === undefined || value === null || value === '') continue
            answers[key] = value as string | number | boolean | string[]
        }
        onSubmit(answers)
    }

    return (
        <div
            data-testid={`elicitation-card-${requestId}`}
            style={{
                padding: 12,
                background: token.colorBgContainer,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 8,
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{serverName}</span>
                <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{message}</span>
                {sdkHints?.displayName && sdkHints.displayName !== serverName ? (
                    <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{sdkHints.displayName}</span>
                ) : null}
                {sdkHints?.title && sdkHints.title !== sdkHints.displayName ? (
                    <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{sdkHints.title}</span>
                ) : null}
                {sdkHints?.description ? (
                    <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{sdkHints.description}</span>
                ) : null}
            </div>

            <Form layout="vertical" onFinish={handleSubmit} disabled={disabled}>
                {fields.map(({ name, field, required }) => (
                    <Form.Item
                        key={name}
                        name={name}
                        label={field.title || name}
                        tooltip={field.description}
                        valuePropName={field.type === 'boolean' ? 'checked' : 'value'}
                        rules={required ? [{ required: true }] : undefined}
                    >
                        {renderFieldControl(field)}
                    </Form.Item>
                ))}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Button disabled={disabled} onClick={() => onDecline()}>
                        {t('chat.elicitation.decline')}
                    </Button>
                    <Button type="primary" htmlType="submit" disabled={disabled}>
                        {t('chat.elicitation.submit')}
                    </Button>
                </div>
            </Form>
        </div>
    )
}
