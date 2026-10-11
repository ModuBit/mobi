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

/**
 * OpenUI ActionEvent → 用户消息文本的组装（generative-ui 票 03 回路②）。
 *
 * 纯函数、无 React 依赖：懒 chunk 内 renderer 消费，测试直接 import。
 * 组装规则：
 * - 仅 continue_conversation（catalog prompt 教学的 send-message 语义）进入组装，
 *   open_url 等其他 action 类型不属于本回路，返回 null；
 * - 文本主体 = humanFriendlyMessage（react-lang 构造：@ToAssistant 的 message /
 *   无显式 Action 的 Button label）；
 * - formState（点击时刻的全部表单值）显式携带——agent 收到的是自描述消息，
 *   不需要回看 UI 才能理解用户选了什么；
 * - 有 formName 时 formState 是 { [formName]: {...fields} } 嵌套形（react-lang
 *   getFormPayload 对命名表单的收口），展开内层字段、表头带表名。
 */

import type { ActionEvent } from '@openuidev/react-lang'

/** ActionEvent 的最小结构投影：测试构造事件不必拉全类型（open_url 等分支不关心） */
export type OpenUIActionInput = Pick<ActionEvent, 'type' | 'humanFriendlyMessage' | 'formState' | 'formName'>

/** 表单值表头的本地化文案（renderer 经 useTranslation 传入；缺省中文——
 *  消息发给 agent 阅读，UI 语言只是呈现偏好） */
export interface OpenUIMessageLabels {
    namedFormValues: (formName: string) => string
    uiValues: string
}

/** 缺省中文表头（actionMessage.test 的既有断言形状） */
const DEFAULT_LABELS: OpenUIMessageLabels = {
    namedFormValues: (formName) => `表单「${formName}」当前值：`,
    uiValues: 'UI 当前值：',
}

/**
 * 组装发给 agent 的用户消息文本；不可发送（非本回路类型 / 无内容）返回 null。
 */
export function buildOpenUIMessage(event: OpenUIActionInput, labels: OpenUIMessageLabels = DEFAULT_LABELS): string | null {
    if (event.type !== 'continue_conversation') return null

    const label = event.humanFriendlyMessage.trim()
    const fields = flattenFormState(event)
    if (!label && fields.length === 0) return null

    const lines: string[] = []
    if (label) lines.push(label)
    if (fields.length > 0) {
        if (label) lines.push('')
        lines.push(event.formName ? labels.namedFormValues(event.formName) : labels.uiValues)
        for (const [key, value] of fields) {
            if (value === undefined) continue
            lines.push(`- ${key}: ${formatValue(value)}`)
        }
    }
    return lines.join('\n')
}

/**
 * formState → 扁平 [key, value] 列表。命名表单（{ [formName]: {...fields} } 单键
 * 嵌套）展开内层；无名快照（整个 store）保持顶层——后者混有非表单 state，
 * 一律拍平反而丢结构。`$` 前缀键是宿主机制变量（reactive bindings，如档③的
 * $actionState），不是用户输入，不进消息文本。
 */
function flattenFormState(event: OpenUIActionInput): [string, unknown][] {
    const formState = event.formState
    if (formState == null || typeof formState !== 'object') return []

    if (event.formName) {
        const inner = (formState as Record<string, unknown>)[event.formName]
        if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
            return Object.entries(inner as Record<string, unknown>)
        }
    }
    return Object.entries(formState).filter(([key]) => !key.startsWith('$'))
}

/** 字段值格式化：对象/数组 JSON 序列化保持结构，原始值 String 收敛。
 *  react-ui 表单字段的 state 形态是 { value: X } 单键包裹（E2E 实测
 *  name: {"value":"林墨墨"}），解包取内值让消息对人/模型都直接可读 */
function formatValue(value: unknown): string {
    if (isValueWrapper(value)) return formatValue(value.value)
    if (typeof value === 'object' && value !== null) {
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }
    return String(value)
}

/** { value: X } 且 X 非 undefined 的单键对象判别（表单字段的包裹形态） */
function isValueWrapper(value: unknown): value is { value: unknown } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    // 类型谓词只作用于调用点，函数体内 unknown 收敛到 object 仍无属性访问权
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
    return keys.length === 1 && keys[0] === 'value' && obj.value !== undefined
}
