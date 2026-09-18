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

import { Folder, Terminal, FileSearch, Monitor, type LucideIcon } from 'lucide-react'
import { DESKTOP_ENTRY_ENABLED } from '@/domain/desktop/featureGate'

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
    /** 打开远程桌面 tab（会话机器未知时为 undefined = 不可用） */
    openDesktop?: () => void
}

/** 检视面板可用动作的唯一真相源：空态卡片列表与「+」下拉菜单共同消费。 */
export interface InspectorActionDescriptor {
    key: 'file' | 'terminal' | 'desktop' | 'review'
    /** lucide 图标组件（调用方按需传 size） */
    Icon: LucideIcon
    /** 文案 i18n key */
    labelKey: string
    /** 暂未支持的动作置灰（审查） */
    disabled: boolean
    /** 可用性判定（缺省 = 可用）：terminal 上限、desktop 机器未知等「为什么禁用」收拢在此 */
    enabled?: (ctx: InspectorActionContext) => boolean
    /** 动作执行 */
    run: (ctx: InspectorActionContext) => void
}

/**
 * 检视面板动作清单。新增/启用某项能力时只改这里（含可用性与执行），
 * 空态卡片与「+」下拉菜单自动一致，避免两处能力漂移。
 * desktop 项受入口闸控制：闸关时整个动作不出现（而非置灰）。
 */
const ALL_INSPECTOR_ACTIONS: readonly InspectorActionDescriptor[] = [
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
        key: 'desktop',
        Icon: Monitor,
        labelKey: 'session.inspector.desktop',
        disabled: false,
        // desktop 跟随会话机器，机器未知（旧数据）时不可用
        enabled: (ctx) => Boolean(ctx.openDesktop),
        run: (ctx) => ctx.openDesktop?.(),
    },
    { key: 'review', Icon: FileSearch, labelKey: 'session.inspector.review', disabled: true, run: () => undefined },
]

export const INSPECTOR_ACTIONS: readonly InspectorActionDescriptor[] = DESKTOP_ENTRY_ENABLED
    ? ALL_INSPECTOR_ACTIONS
    : ALL_INSPECTOR_ACTIONS.filter((action) => action.key !== 'desktop')
