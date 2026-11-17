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
 * skill 清单变更的进程内事件总线（daemon 内部发布-订阅，无 SSE 广播）。
 *
 * 发布方：skills 管理路由（装卸/启停/安装）、reload 命令观测（会话内
 * /reload-skills、/reload-plugins 执行完毕）；消费方：SyncEngine 订阅后交给
 * SdkMetadataRefresher 按事件作用面刷新受影响活跃会话的 sdkMetadata——发布方不感知
 * 消费方，后续新增订阅者（bundled 缓存失效等）只挂订阅，不改任何发布点。
 *
 * 不复用 EventPublisher：它 emit 顺带 SSE 广播给 web 且带 namespace 富化语义，
 * 本总线是纯进程内信号——web 侧的清单刷新已由 sdk-metadata-refreshed SSE 覆盖。
 * 手势（subscribe 返回退订函数 / emit 逐 listener 错误隔离）与 EventPublisher 同款。
 */

import { daemonLogger } from '../logger'

/**
 * skill 清单变更的作用面（显式目标，发布方声明自己实际改了哪一层清单）：
 * - global：管理页对全局目录的装卸/启停/安装——所有活跃会话的清单都可能变；
 * - workspace：管理页对某工作区目录的操作——只圈定该工作区的活跃会话；
 * - session：会话内 reload 命令——只重载发起进程自己的清单，不得外溢。
 */
export type SkillInventoryRefreshTarget =
    | { kind: 'global' }
    | { kind: 'workspace'; workspaceId: string }
    | { kind: 'session'; sessionId: string }

/** skill 清单变更事件（作用面由 target 显式携带，消费方不再从 workspaceId 推断） */
export type SkillInventoryChangedEvent = {
    type: 'skill-inventory-changed'
    namespace: string
    target: SkillInventoryRefreshTarget
}

export type SkillInventoryListener = (event: SkillInventoryChangedEvent) => void

export class SkillInventoryBus {
    private readonly listeners: Set<SkillInventoryListener> = new Set()

    subscribe(listener: SkillInventoryListener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    emit(event: SkillInventoryChangedEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event)
            } catch (error) {
                daemonLogger.error('[skillInventoryBus] Listener error:', error)
            }
        }
    }
}
