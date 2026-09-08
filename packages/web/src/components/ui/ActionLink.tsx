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

import { memo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { message, Popconfirm } from 'antd'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { parseActionUri, type ActionKey, type RegisteredAction } from '@mobi/shared'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'

/**
 * mobi:// 动作链接的 web 执行面（ADR 0003）：
 * - ActionLink：Markdown 链接拦截层的渲染端点，点击解析 URI 并分发到执行器表
 * - ACTION_EXECUTORS：`注册键 → 执行器` 分发表。注册表（shared，协议权威：参数
 *   约束 + 风险等级）与执行器（web，运行时副作用）分离——新增动作 = shared 注册
 *   新键 + 此表补执行器，ActionLink 分发逻辑不动
 * - useActionDispatcher：分发逻辑的 hook 化出口，非链接形态的点击入口
 *   （如用户消息附件卡）用它构造 URI 后走同一条执行链
 */

/** 动作执行所需的运行时能力（路由跳转 + 当前会话上下文；message/send 等后续在此扩展） */
export interface ActionExecutorContext {
    navigate: ReturnType<typeof useNavigate>
    /** 当前会话 id（/sessions/:id 路由内可用；file/open 的 inspector 状态按会话隔离） */
    sessionId?: string
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
    'file/open': (params, { sessionId }) => {
        // 无会话上下文（理论不可达：消息渲染都在 /sessions/:id 路由内）→ 静默忽略
        if (!sessionId) return
        const store = useWorkspaceStore.getState()
        // 两步语义：打开文件 tab（expand !== false 时再检测并展开 inspector，
        // 默认抢屏；expand=false 只静默更新 tab，供「后台准备」类场景）
        store.openFileTab(sessionId, params.path, params.name ?? params.path.split('/').pop() ?? params.path)
        if (params.expand) store.setExpanded(sessionId, true)
    },
}

/**
 * 构造动作分发 hook：解析 URI（未注册/畸形统一 toast 降级）后按注册键分发执行。
 *
 * @param opts.sessionId 覆盖路由推断的会话 id——恢复会话后后端可能 mergeSessions
 * 改变 id，恢复成功方用新 id 重放动作（file/open 的 tab 状态按会话隔离）
 */
export function useActionDispatcher() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { sessionId } = useParams({ strict: false }) as { sessionId?: string }

    return (uri: string, opts?: { sessionId?: string }) => {
        const parsed = parseActionUri(uri)
        if (!parsed?.key) {
            // 未注册（key=null）与畸形（null）统一降级为「不支持的操作」——
            // spec Q10-A：单条文案，不区分参数问题（三态返回保留给未来细分）
            message.info(t('chat.action.unsupported'))
            return
        }
        // 分发点：parsed.key 与 parsed.params 是同一注册键的关联联合，桥接处收窄一次
        // （执行器表类型层面已按键约束参数，收窄不损失内部类型安全）
        const executor = ACTION_EXECUTORS[parsed.key] as ActionExecutor<never>
        executor(parsed.params as never, { navigate, sessionId: opts?.sessionId ?? sessionId })
    }
}

export interface ActionLinkProps {
    /** 完整 mobi URI（即 Markdown 链接的 href） */
    uri: string
    /** 透传原链接元素的 class（如 mention badge 的 mention-badge，保样式连续性） */
    className?: string
    /** 透传内联样式（非 Markdown 场景的局部布局约束，如附件卡的 inline-flex） */
    style?: CSSProperties
    children?: ReactNode
}

/**
 * mobi:// 动作链接（ADR 0003）：点击解析 URI，已注册动作按注册键分发执行；
 * 未注册 / 畸形 URI 统一 toast「不支持的操作」降级（不做静态置灰、不做渲染时目标校验）。
 * 渲染为原生 <a>：复用 `.x-markdown a` 的链接样式与键盘语义，所有 mobi 链接都是
 * 正常链接样式；href 仅作语义与降级展示，点击被 preventDefault 拦截。
 *
 * 会话恢复守卫：会话未激活（session.active === false）时 file/open 动作读不到文件
 * ——点击先弹 Popconfirm 引导恢复会话，恢复成功（后端可能 mergeSessions 变更 id）
 * 后用新 sessionId 重放原动作；取消则什么都不做。session 数据未加载时不拦截。
 */
export const ActionLink = memo(function ActionLink({ uri, className, style, children }: ActionLinkProps) {
    const { t } = useTranslation()
    const dispatch = useActionDispatcher()
    const { sessionId } = useParams({ strict: false }) as { sessionId?: string }
    // 链接所在会话的激活态（file/open 的 tab 状态按会话隔离，恢复后可能变 id）
    const { data: session } = useSession(sessionId ?? null)
    const { resumeSession, isPending: resuming } = useSessionActions(sessionId ?? null)

    const [confirmOpen, setConfirmOpen] = useState(false)
    const pendingUriRef = useRef<string | null>(null)

    // 拦截原生导航与外层冒泡：动作链接的点击语义止于分发（消息行/气泡容器
    // 的祖先 onClick 不得被连带触发，旧 SessionRefLink 的守卫在此重建）
    const requestDispatch = () => {
        // 未激活会话：file/open 读不到文件，先引导恢复（session/open 跨会话跳转不拦）
        if (sessionId && session && session.active === false && uri.startsWith('mobi://file/')) {
            pendingUriRef.current = uri
            setConfirmOpen(true)
            return
        }
        dispatch(uri)
    }

    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault()
        e.stopPropagation()
        requestDispatch()
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        e.stopPropagation()
        requestDispatch()
    }

    /** 确认恢复：成功后用（可能变更的）会话 id 重放原动作；失败 toast 并关闭 */
    const handleResume = async () => {
        const pendingUri = pendingUriRef.current
        try {
            // resumeSession 内部已处理 mergeSessions 的 navigate（新 id 路由替换）
            const newSessionId = await resumeSession()
            if (pendingUri) dispatch(pendingUri, { sessionId: newSessionId || sessionId })
        } catch {
            message.error(t('chat.action.resumeFailed'))
        } finally {
            pendingUriRef.current = null
            setConfirmOpen(false)
        }
    }

    const handleCancel = () => {
        pendingUriRef.current = null
        setConfirmOpen(false)
    }

    return (
        <Popconfirm
            title={t('chat.action.sessionInactive')}
            description={t('chat.action.sessionInactiveHint')}
            open={confirmOpen}
            okText={t('chat.action.resume')}
            cancelText={t('common.cancel')}
            okButtonProps={{ loading: resuming }}
            onConfirm={handleResume}
            onCancel={handleCancel}
        >
            {/* Popconfirm 需要 anchor；链接本体语义不变（键盘 Enter 走同一守卫） */}
            <a href={uri} className={className} style={style} onClick={handleClick} onKeyDown={handleKeyDown}>
                {children}
            </a>
        </Popconfirm>
    )
})
