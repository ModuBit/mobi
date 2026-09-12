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
 * Agent 会话操作服务（B 类工具族的编排入口）。
 *
 * 职责：agent 触达其他会话的全部业务规则——列会话、列机器、建会话、
 * 把消息投给别的会话。**方法是这些规则的唯一入口**：socket handler 只做
 * 外层校验、鉴权、调用、把结果转 ack（与 SessionMessageFactsProcessor /
 * SessionForkStore 的既有分工一致）。
 *
 * 与 A 类（UI 命令）的分界：A 类依赖 Web 在线、是瞬态呈现（不落库）；
 * B 类不依赖 Web，落库即终态。
 *
 * 依赖一律收成窄入参（不直接持 Store / MachineCache），便于单测用内存假件。
 */

import type { AgentMachineSummary } from '@mobi/shared'
import type { Machine } from './machineCache'

export interface AgentSessionServiceDeps {
    /** namespace 内在线的机器；离线机器不出现在结果里（派活目标必须在线） */
    getOnlineMachinesByNamespace: (namespace: string) => Machine[]
}

/** 机器 → agent 视角摘要。展示名取机器自报的 displayName，缺省回退 host。 */
export function toMachineSummary(machine: Machine): AgentMachineSummary {
    return {
        machineId: machine.id,
        name: machine.metadata?.displayName ?? machine.metadata?.host ?? machine.id,
        hostname: machine.metadata?.host ?? machine.id,
        activeAt: machine.activeAt,
    }
}

export class AgentSessionService {
    constructor(private readonly deps: AgentSessionServiceDeps) {}

    /**
     * 列出可派活的机器。
     * 只返回在线机器——离线机器的会话建不起来，列出来只会让 agent 选中一个注定失败的目标。
     */
    listMachines(namespace: string): AgentMachineSummary[] {
        return this.deps.getOnlineMachinesByNamespace(namespace).map(toMachineSummary)
    }
}
