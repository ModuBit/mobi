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

import { useEffect, useRef } from 'react'
import { App, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ArrowRightOutlined } from '@ant-design/icons'
import { useQueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ThemeScope } from '@/core/config/theme/ThemeProvider'
import { useApprovalNotificationStore } from '@/core/data/stores/approvalNotificationStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { Button } from '@/ui/base/interactive/button/Button'
import { ApprovalNotificationCard } from './ApprovalNotificationCard'

/** 关闭钮宽度占 controlHeightLG 的比例（antd notification 的派生公式） */
const CLOSE_BUTTON_RATIO = 0.55
/** 关闭钮与标题行内按钮之间的间隙 */
const CLOSE_BUTTON_GAP = 8

/**
 * 审批通知宿主：把 SSE 投递到信箱的审批请求渲染成**可操作的通知卡片**。
 *
 * 挂载点必须在 app 组装层（MainLayoutHost）：卡片复用 features/chat 的审批面板，
 * 而 core 的 SSEProvider 不许向上引 features，故经 store 信箱解耦（见 approvalNotificationStore）。
 *
 * 生命周期：
 * - 信箱新增条目 → 弹通知（duration 0，处理完才消失）
 * - 卡片里操作成功 / 请求在别处被处理 → 卡片回调 onResolved → 移除条目 → 收起通知
 * - 点通知空白处 → 收起通知并跳转对应会话（跳转能力保留）
 */
export function ApprovalNotificationHost() {
    const { notification } = App.useApp()
    const { token } = antTheme.useToken()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const isMobile = useIsMobile()
    const items = useApprovalNotificationStore((s) => s.items)
    const remove = useApprovalNotificationStore((s) => s.remove)
    /** 已弹过的通知 key：effect 每次随 store 变化重跑，靠它避免重复 info */
    const openedRef = useRef(new Set<string>())
    const closeButtonSize = Math.round(token.controlHeightLG * CLOSE_BUTTON_RATIO)

    useEffect(() => {
        const liveKeys = new Set(items.map((i) => i.key))

        // 先收：条目已移除（处理完 / 登出清空）的通知
        for (const key of [...openedRef.current]) {
            if (!liveKeys.has(key)) {
                openedRef.current.delete(key)
                notification.destroy(key)
            }
        }

        // 再弹：新到条目
        for (const item of items) {
            if (openedRef.current.has(item.key)) continue
            openedRef.current.add(item.key)

            const openSession = () => {
                remove(item.key)
                // 落地地址由 daemon 随通知下发（与普通 toast 同源），避免路由两处拼
                navigate({ to: item.url })
            }

            // 移动端卡片只有 342px 宽，antd 默认左右各 24px 内衬太吃宽度；桌面保留默认值。
            // 关闭钮绝对定位，内衬改了要把它的 insetInlineEnd 一起对齐，否则会错位。
            const paddingX = isMobile ? 16 : token.paddingContentHorizontalLG

            // 不用 notification.info：类型图标会额外占一列（icon 24 + gap 12），
            // 内容区被整体右推、左右留白不对称（移动端实测左 60 / 右 24）
            notification.open({
                key: item.key,
                // 跳转入口放标题行，不进审批卡片——卡片里全是操作按钮，混在一起既挤又容易误点。
                // 这里只有 span + 自管 Button（样式走 :root CSS 变量），不需要主题上下文
                title: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.title}
                        </span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                // 通知整体 onClick 也会跳转，这里必须拦掉，避免重复触发
                                e.stopPropagation()
                                openSession()
                            }}
                            style={{ flexShrink: 0 }}
                        >
                            {t('notification.openSession')} <ArrowRightOutlined />
                        </Button>
                    </div>
                ),
                // antd 的通知内容渲染在**独立 React 根**里，不继承主树 context：
                // react-query / antd 主题必须在内容里重新提供，否则卡片里的
                // useQueryClient / useToken 直接抛错（2026-10-21 E2E 实锤）。
                // 用 ThemeScope 而非 ThemeProvider：后者挂全站副作用（OS 订阅 / data-theme /
                // 注入 shadcn 变量 / 切 i18n），每条通知再挂一份会重复触发全站重渲
                description: (
                    <QueryClientProvider client={queryClient}>
                        <ThemeScope>
                            <ApprovalNotificationCard
                                item={item}
                                onResolved={() => remove(item.key)}
                                onOpen={openSession}
                            />
                        </ThemeScope>
                    </QueryClientProvider>
                ),
                // 审批卡片不该自己倒计时消失：处理完（或请求消失）才收
                duration: 0,
                // 移动端占满可用宽度并贴顶（右上角浮层在窄屏上会压住内容、也不好够到关闭钮）；
                // PC 保持 420 的卡片宽度，内容再长由卡片自己限高内滚
                placement: isMobile ? 'top' : 'topRight',
                style: isMobile
                    ? { width: 'calc(100vw - 24px)', padding: `${token.paddingMD}px ${paddingX}px` }
                    : { width: 420, maxWidth: 'calc(100vw - 32px)', padding: `${token.paddingMD}px ${paddingX}px` },
                // 标题行右侧按钮要给关闭钮让位（内衬 + 关闭钮宽 + 间隙）。
                // 关闭钮尺寸取 antd 的派生公式，token 改了也不会错位
                styles: {
                    title: { paddingInlineEnd: paddingX + closeButtonSize + CLOSE_BUTTON_GAP },
                    close: { insetInlineEnd: paddingX },
                },
                onClick: openSession,
            })
        }
    }, [items, notification, navigate, remove, isMobile, token, closeButtonSize])

    return null
}
