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

import { theme } from 'antd'
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import { agentCardBg } from '@/components/composer/agentPalette'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'

/**
 * Agent 卡片组件（foreground-tasks spec D5/D8）
 * 展示单个前台 Agent 的头像和名称。数据源是 runtime_state.foregroundTasks——
 * 等待审批与执行中统一显示运行中（无 pending 视觉分档）。
 * onClick 缺省 = 详情 block 未加载（消息空窗），点击无响应（守卫由调用方收口）。
 */
export function AgentCard({ name, seed, onClick }: {
    /** 卡片标题：description ?? subagentType ?? 'Agent' 由调用方派生 */
    name: string
    /** 头像与 testid 的种子（toolUseId，跨渲染稳定） */
    seed: string
    onClick?: () => void
}) {
    const { token } = theme.useToken()
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')

    return (
        <div
            data-testid={`agent-card-${seed}`}
            onClick={onClick}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: 'var(--agent-card-width, 200px)',
                height: 40,
                padding: '4px 8px',
                borderRadius: 8,
                cursor: onClick ? 'pointer' : 'default',
                border: 'none',
                background: agentCardBg(name, isDark),
                transition: 'opacity 0.3s',
                boxSizing: 'border-box',
            }}
        >
            <div style={{ flexShrink: 0, lineHeight: 0 }}>
                <PixelAvatar
                    name={seed}
                    status="outputting"
                    size={24}
                />
            </div>
            <div style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
            }}>
                <div style={{
                    fontSize: 11,
                    color: token.colorTextSecondary,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: '1.3',
                }}>
                    {name}
                </div>
                <div style={{
                    fontSize: 9,
                    color: token.colorTextQuaternary,
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: '1.3',
                }}>
                    running
                </div>
            </div>
        </div>
    )
}
