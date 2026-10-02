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

import { Folder, Terminal, FileSearch, type LucideIcon } from 'lucide-react'

/**
 * 动作执行上下文：调用方把「能不能做、怎么做」绑定好后传入。
 * optional 的动作入口即该动作不可用（enabled 判定的一部分）。
 */
export interface InspectorActionContext {
    /** 终端已达单会话上限：terminal 动作禁用 */
    terminalLimitReached: boolean
    /** 打开文件树 tab */
    openFile: () => void
    /** 打开终端 tab */
    openTerminal: () => void
    /** 打开审查 tab（git 审查视图，全局唯一） */
    openReview: () => void
}

/** 检视面板可用动作的唯一真相源：空态卡片列表与「+」下拉菜单共同消费。 */
export interface InspectorActionDescriptor {
    key: 'file' | 'terminal' | 'review'
    /** lucide 图标组件（调用方按需传 size） */
    Icon: LucideIcon
    /** 文案 i18n key */
    labelKey: string
    /** 硬置灰（与 enabled 无关的常禁项；当前无） */
    disabled: boolean
    /** 可用性判定（缺省 = 可用）：terminal 上限等「为什么禁用」收拢在此 */
    enabled?: (ctx: InspectorActionContext) => boolean
    /** 动作执行 */
    run: (ctx: InspectorActionContext) => void
}

/**
 * 检视面板动作清单。新增/启用某项能力时只改这里（含可用性与执行），
 * 空态卡片与「+」下拉菜单自动一致，避免两处能力漂移。
 */
export const INSPECTOR_ACTIONS: readonly InspectorActionDescriptor[] = [
    { key: 'file', Icon: Folder, labelKey: 'session.inspector.openFile', disabled: false, run: (ctx) => ctx.openFile() },
    {
        key: 'terminal',
        Icon: Terminal,
        labelKey: 'session.inspector.terminal',
        disabled: false,
        enabled: (ctx) => !ctx.terminalLimitReached,
        run: (ctx) => ctx.openTerminal(),
    },
    {
        key: 'review',
        Icon: FileSearch,
        labelKey: 'session.inspector.review',
        disabled: false,
        run: (ctx) => ctx.openReview(),
    },
]
