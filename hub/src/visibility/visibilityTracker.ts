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

export type VisibilityState = 'visible' | 'hidden'

export class VisibilityTracker {
    /**
     * 命名空间 -> 可见连接ID集合
     * 用于快速查询某个命名空间下是否有可见连接
     */
    private readonly visibleConnections = new Map<string, Set<string>>()
    /**
     * 连接ID -> 命名空间
     * 反向索引，用于通过连接ID快速定位所属命名空间
     */
    private readonly subscriptionToNamespace = new Map<string, string>()

    registerConnection(subscriptionId: string, namespace: string, state: VisibilityState): void {
        this.removeConnection(subscriptionId)
        this.subscriptionToNamespace.set(subscriptionId, namespace)
        if (state === 'visible') {
            this.addVisibleConnection(namespace, subscriptionId)
        }
    }

    setVisibility(subscriptionId: string, namespace: string, state: VisibilityState): boolean {
        const trackedNamespace = this.subscriptionToNamespace.get(subscriptionId)
        if (!trackedNamespace || trackedNamespace !== namespace) {
            return false
        }

        if (state === 'visible') {
            this.addVisibleConnection(trackedNamespace, subscriptionId)
            return true
        }

        this.removeVisibleConnection(trackedNamespace, subscriptionId)
        return true
    }

    removeConnection(subscriptionId: string): void {
        const namespace = this.subscriptionToNamespace.get(subscriptionId)
        if (!namespace) {
            return
        }

        this.subscriptionToNamespace.delete(subscriptionId)
        this.removeVisibleConnection(namespace, subscriptionId)
    }

    hasVisibleConnection(namespace: string): boolean {
        const visible = this.visibleConnections.get(namespace)
        return Boolean(visible && visible.size > 0)
    }

    isVisibleConnection(subscriptionId: string): boolean {
        const namespace = this.subscriptionToNamespace.get(subscriptionId)
        if (!namespace) {
            return false
        }
        const visible = this.visibleConnections.get(namespace)
        return Boolean(visible && visible.has(subscriptionId))
    }

    private addVisibleConnection(namespace: string, subscriptionId: string): void {
        const existing = this.visibleConnections.get(namespace)
        if (existing) {
            existing.add(subscriptionId)
            return
        }

        this.visibleConnections.set(namespace, new Set([subscriptionId]))
    }

    private removeVisibleConnection(namespace: string, subscriptionId: string): void {
        const existing = this.visibleConnections.get(namespace)
        if (!existing) {
            return
        }

        existing.delete(subscriptionId)
        if (existing.size === 0) {
            this.visibleConnections.delete(namespace)
        }
    }
}
