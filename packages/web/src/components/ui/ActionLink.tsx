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

import { memo, type MouseEvent, type ReactNode } from 'react'
import { message } from 'antd'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { parseActionUri, type ActionKey, type RegisteredAction } from '@mobi/shared'

/**
 * mobi:// 动作链接的 web 执行面（ADR 0003）：
 * - ActionLink：Markdown 链接拦截层的渲染端点，点击解析 URI 并分发到执行器表
 * - ACTION_EXECUTORS：`注册键 → 执行器` 分发表。注册表（shared，协议权威：参数
 *   约束 + 风险等级）与执行器（web，运行时副作用）分离——新增动作 = shared 注册
 *   新键 + 此表补执行器，ActionLink 分发逻辑不动
 */

/** 动作执行所需的运行时能力（当前仅路由跳转；file/open、message/send 等后续在此扩展） */
export interface ActionExecutorContext {
    navigate: ReturnType<typeof useNavigate>
}

/** 单个动作执行器：参数是 shared 注册表校验后的强类型载荷 */
export type ActionExecutor<P> = (params: P, ctx: ActionExecutorContext) => void

/** 动作执行器分发表：键面与 shared ACTION_REGISTRY 一一对应（类型层面强制完备） */
const ACTION_EXECUTORS: {
    [K in ActionKey]: ActionExecutor<RegisteredAction<K>['params']>
} = {
    'session/open': (params, { navigate }) => {
        // 会话不存在不做渲染时校验：navigate 后由会话页既有 not-found 态承接（ADR 0003 Q10-A）
        void navigate({ to: '/sessions/$sessionId', params: { sessionId: params.id } })
    },
}

export interface ActionLinkProps {
    /** 完整 mobi URI（即 Markdown 链接的 href） */
    uri: string
    children?: ReactNode
}

/**
 * mobi:// 动作链接（ADR 0003）：点击解析 URI，已注册动作按注册键分发执行；
 * 未注册 / 畸形 URI 统一 toast「不支持的操作」降级（不做静态置灰、不做渲染时目标校验）。
 * 渲染为原生 <a>：复用 `.x-markdown a` 的链接样式与键盘语义，所有 mobi 链接都是
 * 正常链接样式；href 仅作语义与降级展示，点击被 preventDefault 拦截。
 */
export const ActionLink = memo(function ActionLink({ uri, children }: ActionLinkProps) {
    const { t } = useTranslation()
    const navigate = useNavigate()

    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
        // 拦截原生导航：mobi URI 不是 http 资源，动作经本页路由分发
        e.preventDefault()
        const parsed = parseActionUri(uri)
        if (!parsed?.key) {
            // 未注册（key=null）与畸形（null）同一降级——结构上不存在该动作
            message.info(t('chat.action.unsupported'))
            return
        }
        // 分发点：parsed.key 与 parsed.params 是同一注册键的关联联合，桥接处收窄一次
        // （执行器表类型层面已按键约束参数，收窄不损失内部类型安全）
        const executor = ACTION_EXECUTORS[parsed.key] as ActionExecutor<never>
        executor(parsed.params as never, { navigate })
    }

    return (
        <a href={uri} onClick={handleClick}>
            {children}
        </a>
    )
})
