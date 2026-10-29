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

/** Bubble.List role 配置 */
export const BUBBLE_ROLES = {
    assistant: {
        placement: 'start' as const,
        variant: 'borderless' as const,
        // assistant 气泡贯穿整列：清掉 antdx Bubble 对 start 行内置的 15% 对侧
        // 留白（库规则非 !important，root 语义槽位内联样式直接胜出，作用域精确到
        // 角色——不用全局 CSS !important，Drawer 经展开自动一致）。
        // 守卫测试：tests/assistant-bubble-fullwidth.test.ts
        styles: { root: { paddingInlineEnd: 0 } },
    },
    user: {
        placement: 'end' as const,
    },
    system: {
        // 显式 start + root 内联 justify：antdx 的 .ant-bubble-system 内置水平居中，
        // 优先级压过 placement-start 类（wakeup 系统行实测仍居中）——内联样式胜出。
        // 系统行语义是左侧标识行（参照 GoalRow）。loading 类居中内容不依赖此 center
        // （其 content 自带全宽 div + justify-content:center，见 BubbleListChat）
        placement: 'start' as const,
        variant: 'borderless' as const,
        styles: { root: { justifyContent: 'flex-start' }, content: { paddingBlock: 0, minHeight: 'auto' } },
    },
    divider: {
        dividerProps: {
            variant: 'dashed' as const,
            style: { borderColor: 'var(--ant-color-border)' },
        },
    },
}
