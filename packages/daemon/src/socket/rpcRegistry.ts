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

import type { Socket } from 'socket.io'

export class RpcRegistry {
    private readonly methodToSocketId: Map<string, string> = new Map()
    private readonly socketIdToMethods: Map<string, Set<string>> = new Map()

    register(socket: Socket, method: string): void {
        if (!method) {
            return
        }

        this.methodToSocketId.set(method, socket.id)

        const existing = this.socketIdToMethods.get(socket.id)
        if (existing) {
            existing.add(method)
        } else {
            this.socketIdToMethods.set(socket.id, new Set([method]))
        }
    }

    unregister(socket: Socket, method: string): void {
        const socketId = this.methodToSocketId.get(method)
        if (socketId === socket.id) {
            this.methodToSocketId.delete(method)
        }

        const methods = this.socketIdToMethods.get(socket.id)
        if (methods) {
            methods.delete(method)
            if (methods.size === 0) {
                this.socketIdToMethods.delete(socket.id)
            }
        }
    }

    unregisterAll(socket: Socket): void {
        const methods = this.socketIdToMethods.get(socket.id)
        if (!methods) {
            return
        }
        for (const method of methods) {
            const socketId = this.methodToSocketId.get(method)
            if (socketId === socket.id) {
                this.methodToSocketId.delete(method)
            }
        }
        this.socketIdToMethods.delete(socket.id)
    }

    getSocketIdForMethod(method: string): string | null {
        return this.methodToSocketId.get(method) ?? null
    }
}

