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
 * MainLayout 的懒加载装配外壳：注入聊天块渲染注册表，再渲染 MainLayout。
 *
 * 为什么需要这层壳（而非在 MainLayout 内直接挂）：
 * - 装配权归组装层——features/layout 引 features/chat 是域间互引，depcruise 硬卡；
 * - 为什么要包在懒加载 chunk 里——渲染注册表连带 Markdown / 代码高亮 / 工具卡整栈，
 *   挂在 eager 的 App 根会把它们拉进主入口 bundle（登录路径也白下），挂到这里则随
 *   MainLayout chunk 一起懒加载（该 chunk 认证后会被空闲预取）。
 * 消费方只有 AgentDrawerContent（chat 渲染树内），登录页不消费，故不存在「MainLayout
 * 之外还需注册表」的缺口。
 */

import { MainLayout } from '@/features/layout/MainLayout'
import { BubbleRenderProvider, type BubbleRenderers } from '@/features/chat/blocks/renderContext'
import { renderChatBlock } from '@/features/chat/blocks'
import { ToolCallGroupRenderer } from '@/features/chat/blocks/toolCallGroupBlock'

// 注册表值不含组件状态，模块级常量即可：Context value 引用恒定，
// 不会因外壳重渲而触发下游消费者重渲
const RENDERERS: BubbleRenderers = {
    renderBlock: renderChatBlock,
    renderToolGroup: (p) => <ToolCallGroupRenderer {...p} />,
}

export function MainLayoutHost() {
    return (
        <BubbleRenderProvider value={RENDERERS}>
            <MainLayout />
        </BubbleRenderProvider>
    )
}
