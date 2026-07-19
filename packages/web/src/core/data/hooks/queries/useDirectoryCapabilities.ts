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
import { useMobiApi } from '@/core/data/api/client'
import { useSDKMetadata } from './useSDKMetadata'
import { useMachineMetadata } from './useMachineMetadata'
import type { SDKMetadata, Command, ListFilesResponse, UploadFileResponse, DeleteUploadResponse } from '@/core/data/api/types'

/**
 * 资源定位目标：tagged union 区分 session 通道与 machine 通道
 */
export type CapabilityTarget =
    | { kind: 'session'; sessionId: string }
    | { kind: 'machine'; machineId: string; cwd: string }

/** searchFiles/listDirectory 返回体（@ 文件引用双通道共用） */
export type FileSearchResult = { data: ListFilesResponse }
/** uploadFile 返回体 */
export type UploadResult = { data: UploadFileResponse }
/** deleteUpload 返回体 */
export type DeleteUploadResult = { data: DeleteUploadResponse }

/** 统一的目录搜索/列表方法签名（session 与 machine 通道共用） */
export type SearchFilesFn = (query: string, opts?: { signal?: AbortSignal }) => Promise<FileSearchResult>
export type ListDirectoryFn = (path: string, prefix: string | undefined, opts?: { signal?: AbortSignal }) => Promise<FileSearchResult>
export type UploadFileFn = (file: File, opts?: { signal?: AbortSignal; onProgress?: (percent: number) => void }) => Promise<UploadResult>
export type DeleteUploadFn = (path: string) => Promise<DeleteUploadResult>

/**
 * 目录级能力的统一接口
 * 无论底层走 session 还是 machine 通道，消费者只看到同一套方法
 */
export interface DirectoryCapabilities {
    metadata: SDKMetadata | null
    metadataLoading: boolean
    commands: Command[]
    searchFiles: SearchFilesFn
    listDirectory: ListDirectoryFn
    uploadFile: UploadFileFn
    deleteUpload: DeleteUploadFn
}

/**
 * 资源定位抽象 hook
 * 根据 CapabilityTarget 自动路由到 session 或 machine 通道，
 * 返回统一的 DirectoryCapabilities 接口
 *
 * @param options.metadataEnabled 是否启用 metadata 查询（含 commands），
 *   默认 true。NewSessionPage 中可延迟到用户首次输入 '/' 时再启用，
 *   避免每输入一个目录字符就触发 metadata 请求
 */
export function useDirectoryCapabilities(
    target: CapabilityTarget | null,
    options?: { metadataEnabled?: boolean },
): DirectoryCapabilities {
    const api = useMobiApi()
    const metadataEnabled = options?.metadataEnabled ?? true

    // 选择正确的 metadata 通道
    const sessionMeta = useSDKMetadata(
        target?.kind === 'session' ? target.sessionId : null,
        metadataEnabled,
    )
    const machineMeta = useMachineMetadata(
        target?.kind === 'machine' ? target.machineId : null,
        target?.kind === 'machine' ? target.cwd : null,
        metadataEnabled,
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

    // 统一 API 方法（未指定 target 时返回 no-op，cookie 自动带认证）
    const searchFiles = useMemo(() => {
        if (!target) return async () => ({ data: { success: false } })
        if (target.kind === 'session') {
            return (query: string, opts?: { signal?: AbortSignal }) =>
                api.sessions.searchFiles(target.sessionId, query, undefined, opts)
        }
        return (query: string, opts?: { signal?: AbortSignal }) =>
            api.machines.searchFiles(target.machineId, target.cwd, query, opts)
    }, [target, api])

    const listDirectory = useMemo(() => {
        if (!target) return async () => ({ data: { success: false } })
        if (target.kind === 'session') {
            return (path: string, prefix: string | undefined, opts?: { signal?: AbortSignal }) =>
                api.sessions.listDirectory(target.sessionId, path, prefix, opts)
        }
        return (path: string, prefix: string | undefined, opts?: { signal?: AbortSignal }) =>
            api.machines.listSessionDirectory(target.machineId, target.cwd, path, prefix, opts)
    }, [target, api])

    const uploadFile = useMemo(() => {
        if (!target) return async () => ({ data: { success: false } })
        if (target.kind === 'session') {
            return (file: File, opts?: { signal?: AbortSignal }) =>
                api.sessions.upload(target.sessionId, file, opts)
        }
        return (file: File, opts?: { signal?: AbortSignal }) =>
            api.machines.upload(target.machineId, target.cwd, file, opts)
    }, [target, api])

    const deleteUpload = useMemo(() => {
        if (!target) return async () => ({ data: { success: false } })
        if (target.kind === 'session') {
            return (path: string) => api.sessions.deleteUpload(target.sessionId, path)
        }
        return (path: string) => api.machines.deleteUpload(target.machineId, target.cwd, path)
    }, [target, api])

    return useMemo(() => ({
        metadata, metadataLoading, commands,
        searchFiles, listDirectory, uploadFile, deleteUpload,
    }), [metadata, metadataLoading, commands, searchFiles, listDirectory, uploadFile, deleteUpload])
}
