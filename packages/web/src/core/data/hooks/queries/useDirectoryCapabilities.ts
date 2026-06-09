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

import { useMemo } from 'react'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import { useSDKMetadata } from './useSDKMetadata'
import { useMachineMetadata } from './useMachineMetadata'
import type { SDKMetadata, Command } from '@/core/data/api/types'

/**
 * 资源定位目标：tagged union 区分 session 通道与 machine 通道
 */
export type CapabilityTarget =
    | { kind: 'session'; sessionId: string }
    | { kind: 'machine'; machineId: string; cwd: string }

/**
 * 目录级能力的统一接口
 * 无论底层走 session 还是 machine 通道，消费者只看到同一套方法
 */
export interface DirectoryCapabilities {
    metadata: SDKMetadata | null
    metadataLoading: boolean
    commands: Command[]
    searchFiles: (query: string, opts?: { signal?: AbortSignal }) => Promise<any>
    listDirectory: (path: string, opts?: { signal?: AbortSignal }) => Promise<any>
    uploadFile: (file: File, opts?: { signal?: AbortSignal }) => Promise<any>
    deleteUpload: (path: string) => Promise<any>
}

/**
 * 资源定位抽象 hook
 * 根据 CapabilityTarget 自动路由到 session 或 machine 通道，
 * 返回统一的 DirectoryCapabilities 接口
 */
export function useDirectoryCapabilities(target: CapabilityTarget | null): DirectoryCapabilities {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    // 选择正确的 metadata 通道
    const sessionMeta = useSDKMetadata(target?.kind === 'session' ? target.sessionId : null)
    const machineMeta = useMachineMetadata(
        target?.kind === 'machine' ? target.machineId : null,
        target?.kind === 'machine' ? target.cwd : null,
    )

    const metadata = target?.kind === 'session'
        ? (sessionMeta.data ?? null)
        : (machineMeta.data ?? null)

    const metadataLoading = target?.kind === 'session'
        ? sessionMeta.isLoading
        : machineMeta.isLoading

    const commands = useMemo<Command[]>(
        () => metadata?.commands ?? [],
        [metadata?.commands]
    )

    // 统一 API 方法
    const searchFiles = useMemo(() => {
        if (!target || !token) return async () => ({ data: { success: false } })
        if (target.kind === 'session') {
            return (query: string, opts?: { signal?: AbortSignal }) =>
                api.sessions.searchFiles(target.sessionId, query, opts)
        }
        return (query: string, opts?: { signal?: AbortSignal }) =>
            api.machines.searchFiles(target.machineId, target.cwd, query, opts)
    }, [target, token, api])

    const listDirectory = useMemo(() => {
        if (!target || !token) return async () => ({ data: { success: false } })
        if (target.kind === 'session') {
            return (path: string, opts?: { signal?: AbortSignal }) =>
                api.sessions.listDirectory(target.sessionId, path, opts)
        }
        return (path: string, opts?: { signal?: AbortSignal }) =>
            api.machines.listSessionDirectory(target.machineId, target.cwd, path, opts)
    }, [target, token, api])

    const uploadFile = useMemo(() => {
        if (!target || !token) return async () => ({ data: { success: false } })
        if (target.kind === 'session') {
            return (file: File, opts?: { signal?: AbortSignal }) =>
                api.sessions.upload(target.sessionId, file, opts)
        }
        return (file: File, opts?: { signal?: AbortSignal }) =>
            api.machines.upload(target.machineId, target.cwd, file, opts)
    }, [target, token, api])

    const deleteUpload = useMemo(() => {
        if (!target || !token) return async () => ({ data: { success: false } })
        if (target.kind === 'session') {
            return (path: string) => api.sessions.deleteUpload(target.sessionId, path)
        }
        return (path: string) => api.machines.deleteUpload(target.machineId, target.cwd, path)
    }, [target, token, api])

    return { metadata, metadataLoading, commands, searchFiles, listDirectory, uploadFile, deleteUpload }
}
