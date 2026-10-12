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
 * mobi 视角的 openui 组件库（per-action 粒度票 02）：在官方 openuiLibrary 之上
 * 覆盖 Button——react-lang 的 ActionEvent 不携带操作身份（formPayload 在 steps
 * 循环前捕获，`Set` 置位不进载荷，实测 exports-Cab8UG5o.mjs triggerAction），
 * per-action 身份只能由渲染层提供：RenderNodeInner 给每个组件实例传 statementId，
 * 覆盖组件用 React capture 事件在**同步帧**把被点按钮的 statementId 写入 registry，
 * renderer 的 onAction 同步读走（同一事件循环任务内 capture 先于子 onClick，
 * 无交错窗口）。renderer 拿 statementId 回查绑定表（bindingParser.actions）即得
 * 操作状态变量。其余组件原样透传。
 */

import type { ComponentRenderProps, Library } from '@openuidev/react-lang'
import { openuiLibrary } from '@openuidev/react-ui'
import type { ReactNode } from 'react'

/** 点击 registry 的 globalThis 槽位：Symbol.for 键跨模块实例共享。vite dev
 *  re-optimize 会产生同一模块的两个实例（E2E 2026-10-11 实锤：写读落不同实例，
 *  刷新后首次点击身份 miss），模块级变量各持一份必断 */
const CLICKED_ID_KEY = Symbol.for('mobi.openui.clickedActionStatementId')

type RegistryHost = Record<symbol, string | null>

/** 写入点击身份（Button capture 同步帧调用） */
function writeClickedStatementId(id: string | null): void {
    ;(globalThis as RegistryHost)[CLICKED_ID_KEY] = id
}

/** 测试跨实例写入用（与组件 capture 写同一位）；产品代码勿用 */
export function writeClickedStatementIdForTest(id: string | null): void {
    writeClickedStatementId(id)
}

/** renderer onAction 入口取走点击身份（取后即清——陈旧身份不得跨事件存活） */
export function takeClickedActionStatementId(): string | null {
    const host = globalThis as RegistryHost
    const id = host[CLICKED_ID_KEY] ?? null
    host[CLICKED_ID_KEY] = null
    return id
}

const originalButton = openuiLibrary.components.Button

type ButtonComponent = typeof originalButton

const mobiButton: ButtonComponent = {
    ...originalButton,
    component: (ctx: ComponentRenderProps): ReactNode => {
        const render = originalButton.component as (c: ComponentRenderProps) => ReactNode
        const inner = render(ctx)
        // display:contents 无盒包裹——不参与布局，只挂 capture 监听（子 onClick 在
        // bubble 阶段，capture 必然先行）
        return (
            <span
                style={{ display: 'contents' }}
                onClickCapture={() => {
                    writeClickedStatementId(ctx.statementId ?? null)
                }}
            >
                {inner}
            </span>
        )
    },
}

/** mobi 视角组件库：仅 Button 被覆盖，其余（含 Form/CheckBoxGroup 等）原样透传 */
export const mobiLibrary: Library = {
    ...openuiLibrary,
    components: {
        ...openuiLibrary.components,
        Button: mobiButton,
    },
}
