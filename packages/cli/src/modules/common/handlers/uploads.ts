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

import { logger } from '@/ui/logger'
import { mkdir, writeFile, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, relative, extname, sep } from 'path'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { getErrorMessage, rpcError } from '../rpcResponses'
import { getUploadsDir } from '@/constants/uploadPaths'
import { ALLOWED_EXTENSIONS_SET, BLOCKED_EXTENSIONS_SET, MAX_UPLOAD_BYTES } from '@mobi/shared/upload'

interface UploadFileRequest {
    filename: string
    content: string  // base64 编码
    mimeType: string
}

interface UploadFileResponse {
    success: boolean
    path?: string
    error?: string
}

interface DeleteUploadRequest {
    path: string
}

interface DeleteUploadResponse {
    success: boolean
    error?: string
}

/**
 * 校验文件扩展名是否合法
 *
 * @param filename 文件名
 * @returns 错误信息，如果合法则返回 null
 */
function validateFileExtension(filename: string): string | null {
    const ext = extname(filename).toLowerCase()

    if (!ext) {
        return 'File must have an extension'
    }

    if (BLOCKED_EXTENSIONS_SET.has(ext)) {
        return `File type "${ext}" is not allowed (executable)`
    }

    // 白名单校验：不在白名单中的扩展名也拒绝
    if (!ALLOWED_EXTENSIONS_SET.has(ext)) {
        return `File type "${ext}" is not supported`
    }

    return null
}

/**
 * 清理文件名，移除危险字符
 *
 * - 移除路径分隔符
 * - 移除 .. 路径遍历
 * - 限制长度
 */
function sanitizeFilename(filename: string): string {
    const sanitized = filename
        .replace(/[/\\]/g, '_')        // 路径分隔符
        .replace(/[^\w\-\.]/g, '_')    // 非安全字符替换为 _（对齐 ATTACHMENT_RE 的 [\w\-\.]）
        .slice(0, 255)

    // 如果清理后文件名为空，使用默认名
    return sanitized || 'upload'
}

/**
 * 估算 base64 编码后的字节数
 */
function estimateBase64Bytes(base64: string): number {
    const len = base64.length
    if (len === 0) return 0
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    return Math.floor((len * 3) / 4) - padding
}

/** 上传目录就绪缓存，避免同月重复 stat + readFile */
const uploadDirCache = new Map<string, string>()

/**
 * 确保上传目录存在并创建 .mobi/.gitignore
 *
 * 创建目录结构：
 * - .mobi/uploads/YYYY-MM/ 按月归档
 * - .mobi/.gitignore 排除 uploads 和 artifacts 目录
 *
 * @param projectRoot 项目根目录
 * @returns 当月上传目录的绝对路径
 */
async function ensureUploadDir(projectRoot: string): Promise<string> {
    // 按月组织：YYYY-MM
    const now = new Date()
    const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    // 缓存命中则直接返回
    const cacheKey = `${projectRoot}:${monthDir}`
    const cached = uploadDirCache.get(cacheKey)
    if (cached) return cached

    const uploadsRoot = getUploadsDir(projectRoot)
    const uploadDir = join(uploadsRoot, monthDir)

    if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true })
    }

    // 确保 .mobi/.gitignore 存在且包含 uploads/ 和 artifacts/
    const mobiDir = join(projectRoot, '.mobi')
    const gitignorePath = join(mobiDir, '.gitignore')
    const requiredEntries = ['uploads/', 'artifacts/']

    if (!existsSync(gitignorePath)) {
        await mkdir(mobiDir, { recursive: true })
        await writeFile(gitignorePath, requiredEntries.join('\n') + '\n', 'utf-8')
    } else {
        // 检查已有内容，补充缺失的条目
        const content = await readFile(gitignorePath, 'utf-8')
        const lines = content.split('\n')
        const missing = requiredEntries.filter(entry => !lines.includes(entry))
        if (missing.length > 0) {
            // 在末尾追加缺失的条目
            const newContent = content.endsWith('\n')
                ? content + missing.join('\n') + '\n'
                : content + '\n' + missing.join('\n') + '\n'
            await writeFile(gitignorePath, newContent, 'utf-8')
        }
    }

    // 缓存已就绪的目录路径
    uploadDirCache.set(cacheKey, uploadDir)
    return uploadDir
}

/**
 * 校验路径是否在 uploads 目录内（防止路径遍历攻击）
 */
function isPathWithinUploads(projectRoot: string, relativePath: string): boolean {
    const uploadsRoot = getUploadsDir(projectRoot)
    const resolvedPath = resolve(projectRoot, relativePath)
    const normalizedUploads = uploadsRoot.endsWith(sep)
        ? uploadsRoot
        : `${uploadsRoot}${sep}`

    return resolvedPath.startsWith(normalizedUploads)
}

/**
 * 清理上传目录（已废弃）
 *
 * 新版本使用 .mobi/uploads/ 持久化存储，不再需要按 session 清理。
 * 此函数保留为空操作以兼容现有调用方（apiSession.sendSessionDeath），
 * 后续 Task 2 中会移除调用方并删除此函数。
 *
 * @deprecated 不再需要，将在 Task 2 中移除调用方
 */
export async function cleanupUploadDir(_sessionId?: string): Promise<void> {
    // 新版本使用持久化存储，无需清理
}

/**
 * 注册上传相关的 RPC handlers
 *
 * @param rpcHandlerManager RPC 处理器管理器
 * @param workingDirectory 当前工作目录（项目根目录）
 */
export function registerUploadHandlers(
    rpcHandlerManager: RpcHandlerManager,
    workingDirectory: string,
): void {
    // 上传文件
    rpcHandlerManager.registerHandler<UploadFileRequest, UploadFileResponse>(
        'uploadFile',
        async (data) => {
            logger.debug('上传文件请求:', data.filename, 'mimeType:', data.mimeType)

            if (!data.filename) {
                return rpcError('Filename is required')
            }

            if (!data.content) {
                return rpcError('Content is required')
            }

            try {
                // 校验文件扩展名
                const extError = validateFileExtension(data.filename)
                if (extError) {
                    return rpcError(extError)
                }

                // 估算文件大小
                const estimatedBytes = estimateBase64Bytes(data.content)
                if (estimatedBytes > MAX_UPLOAD_BYTES) {
                    return rpcError('File too large (max 50MB)')
                }

                // 确保上传目录存在
                const uploadDir = await ensureUploadDir(workingDirectory)

                // 清理文件名并添加时间戳避免冲突
                const sanitizedFilename = sanitizeFilename(data.filename)
                const timestamp = Date.now()
                const uniqueFilename = `${timestamp}-${sanitizedFilename}`
                const filePath = join(uploadDir, uniqueFilename)

                // 解码 base64 并写入文件
                const buffer = Buffer.from(data.content, 'base64')
                if (buffer.length > MAX_UPLOAD_BYTES) {
                    return rpcError('File too large (max 50MB)')
                }
                await writeFile(filePath, buffer)

                // 返回项目相对路径
                const relativePath = relative(workingDirectory, filePath)

                logger.debug('文件上传成功:', relativePath)
                return { success: true, path: relativePath }
            } catch (error) {
                logger.debug('文件上传失败:', error)
                return rpcError(getErrorMessage(error, 'Failed to upload file'))
            }
        },
    )

    // 删除上传文件
    rpcHandlerManager.registerHandler<DeleteUploadRequest, DeleteUploadResponse>(
        'deleteUpload',
        async (data) => {
            const path = data?.path?.trim()
            if (!path) {
                return rpcError('Path is required')
            }

            // 校验路径在 uploads 目录内
            if (!isPathWithinUploads(workingDirectory, path)) {
                return rpcError('Invalid upload path')
            }

            try {
                const fullPath = resolve(workingDirectory, path)
                await rm(fullPath, { force: true })
                return { success: true }
            } catch (error) {
                logger.debug('删除上传文件失败:', error)
                return rpcError(getErrorMessage(error, 'Failed to delete upload file'))
            }
        },
    )
}
