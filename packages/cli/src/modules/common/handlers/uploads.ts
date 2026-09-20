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
import { mkdir, writeFile, rm, readFile, open, stat, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, relative, extname, sep, dirname, basename } from 'path'
import { homedir } from 'os'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { getErrorMessage, rpcError } from '../rpcResponses'
import { getUploadsDir } from '@/constants/uploadPaths'
import { ALLOWED_EXTENSIONS_SET, BLOCKED_EXTENSIONS_SET, MAX_UPLOAD_BYTES } from '@mobi/shared/upload'

/**
 * 校验 RPC 参数中的 cwd 是否在安全范围内
 * 纵深防御：即使 hub 侧已校验，CLI 侧也确保 cwd 在 home 目录内
 */
function validateRpcCwd(cwd: string): boolean {
    const resolved = resolve(cwd)
    const home = homedir()
    const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    const normalizedHome = process.platform === 'win32' ? home.toLowerCase() : home
    const homePrefix = normalizedHome.endsWith('/') ? normalizedHome : normalizedHome + '/'
    return normalized === normalizedHome || normalized.startsWith(homePrefix)
}

interface WriteFileRangeRequest {
    /** 首块（offset=0）用：原始文件名，cli 生成唯一名 */
    filename?: string
    /** 后续块（offset>0）用：首块返回的项目相对路径 */
    path?: string
    offset: number
    /** 二进制块（Socket.IO 附件，非 base64） */
    content: Uint8Array
    /** 覆盖工作目录（machine channel 传入） */
    cwd?: string
    /** 首块传：总大小预校验 */
    totalSize?: number
}

interface WriteFileRangeResponse {
    success: boolean
    /** 首块返回：项目相对路径 */
    path?: string
    /** 本次写入字节数 */
    written?: number
    error?: string
}

interface DeleteUploadRequest {
    path: string
    /** 覆盖工作目录（machine channel 传入） */
    cwd?: string
}

interface DeleteUploadResponse {
    success: boolean
    error?: string
}

interface ReplaceUploadRequest {
    /** 目标路径（项目相对，须在 uploads 目录内）：文件名原样保留不进唯一名生成——
     *  替换语义要求 path 恒定，附件 id / 草稿引用 / 扩展名全部不动 */
    path: string
    /** 全量内容（单发整文件）：分块协议下「旧文件何时删」需要 commit 信号，很别扭；
     *  替换场景产物小（≤50MB 上限内），单发让「新文件完整落盘后才生效」天然成立 */
    content: Uint8Array
    /** 覆盖工作目录（machine channel 传入） */
    cwd?: string
}

interface ReplaceUploadResponse {
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
        .replace(/[^\w\-.]/g, '_')    // 非安全字符替换为 _（对齐 ATTACHMENT_RE 的 [\w-.]）
        .slice(0, 255)

    // 如果清理后文件名为空，使用默认名
    return sanitized || 'upload'
}

/**
 * 累计写入追踪（path → 已写字节），用于累计超限兜底。
 * 进程内 Map，随 cli 进程生命周期。
 * 依赖 hub 侧 emitWithAck 串行背压，cli 侧单线程顺序处理同一文件的上传块，此处无锁。
 */
const writtenTracker = new Map<string, { written: number; totalSize?: number }>()

/**
 * 上传目录就绪缓存，避免同月重复 stat + readFile。
 * 条目键为 projectRoot:月份 —— 目录一旦就绪永久有效，非泄漏；
 * 单项目年增 12 条后稳定，多项目按项目数线性增长，无需 LRU。
 */
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
    // 分块写文件（替换旧 base64 整包 uploadFile，对称 readFileRange 无状态）
    rpcHandlerManager.registerHandler<WriteFileRangeRequest, WriteFileRangeResponse>(
        'writeFileRange',
        async (data) => {
            logger.debug('写入文件块:', data.filename ?? data.path, 'offset:', data.offset, 'len:', data.content.length)

            // 优先使用 RPC 参数中的 cwd，否则使用注册时的 workingDirectory
            const effectiveCwd = data.cwd || workingDirectory
            if (data.cwd && !validateRpcCwd(data.cwd)) {
                return rpcError('Invalid cwd: path is outside home directory')
            }

            // offset / content 基本校验
            if (!Number.isFinite(data.offset) || data.offset < 0) {
                return rpcError('Invalid offset')
            }
            if (!(data.content instanceof Uint8Array) || data.content.length === 0) {
                return rpcError('Content is required')
            }

            try {
                if (data.offset === 0 && data.filename) {
                    // ── 首块：创建文件 ──
                    const extError = validateFileExtension(data.filename)
                    if (extError) return rpcError(extError)

                    // 总大小预校验（第二道闸；hub 已 Content-Length 预校验为第一道）
                    if (typeof data.totalSize === 'number' && Number.isFinite(data.totalSize) && data.totalSize > MAX_UPLOAD_BYTES) {
                        return rpcError('File too large (max 50MB)')
                    }

                    const uploadDir = await ensureUploadDir(effectiveCwd)
                    const sanitizedFilename = sanitizeFilename(data.filename)
                    // 时间戳 + 随机段，避免同毫秒同名并发上传碰撞（open('w') 覆盖丢数据）。
                    // 随机段插在「扩展簇」（尾部连续 .ext，如 .excalidraw.png / .tar.gz）之前，
                    // 保持多段扩展名完整——extname 只认最后一段会把双扩展拆成 .excalidraw-<id>.png
                    const shortId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
                    // 前导点（.gitignore / .env 等隐藏文件）属文件名而非扩展名：先剥离再匹配
                    // 扩展簇，否则 base 为空 → 唯一名变成以连字符开头的 '-<id>.gitignore'
                    const leadingDot = sanitizedFilename.startsWith('.') ? '.' : ''
                    const stem = leadingDot ? sanitizedFilename.slice(1) : sanitizedFilename
                    const extCluster = stem.match(/(?:\.[A-Za-z0-9]+)+$/)?.[0] ?? ''
                    const base = extCluster ? stem.slice(0, stem.length - extCluster.length) : stem
                    const uniqueFilename = `${leadingDot}${base}-${shortId}${extCluster}`
                    const filePath = join(uploadDir, uniqueFilename)

                    // 单块大小校验（第三道闸）
                    if (data.content.length > MAX_UPLOAD_BYTES) return rpcError('File too large (max 50MB)')

                    // open 成功后若 write/close 失败（磁盘满 / EIO），文件已落盘但 path 尚未返回 hub，
                    // hub 侧 cleanup 因无 path 无法清理 → 内层兜底删除孤儿文件
                    const fd = await open(filePath, 'w')  // 创建/截断
                    try {
                        await fd.write(data.content, 0, data.content.length, 0)
                        await fd.close()
                    } catch (writeErr) {
                        await fd.close().catch(() => {})
                        await rm(filePath, { force: true }).catch(() => {})
                        logger.debug('首块写入失败，已清理孤儿文件:', filePath, writeErr)
                        return rpcError(getErrorMessage(writeErr, 'Failed to write file range'))
                    }

                    // 记录累计（open 成功后写入，避免孤儿 entry）；单块即完成则清理，防止 Map 无限增长
                    writtenTracker.set(filePath, { written: data.content.length, totalSize: data.totalSize })
                    if (data.totalSize !== undefined && data.content.length >= data.totalSize) {
                        writtenTracker.delete(filePath)
                    }

                    return { success: true, path: relative(effectiveCwd, filePath), written: data.content.length }
                } else if (data.path && data.offset > 0) {
                    // ── 后续块：按 path + offset 追加（offset>0；首块由 filename 分支处理，offset=0+path 拒绝） ──
                    if (!isPathWithinUploads(effectiveCwd, data.path)) {
                        return rpcError('Invalid upload path')
                    }
                    const fullPath = resolve(effectiveCwd, data.path)

                    const st = await stat(fullPath)
                    // 纵深防御：offset 不得超过当前文件 size，防止稀疏文件空洞绕过大小限制
                    if (data.offset > st.size) {
                        return rpcError('Offset out of bounds')
                    }

                    // 累计超限兜底：基数取 tracker 记录与实际文件大小的较大者。
                    // 仅看进程内 tracker 会在 cli 重启 / 指向既有文件时回退到 0，从而绕过封顶。
                    const prev = writtenTracker.get(fullPath)
                    const baseWritten = Math.max(prev?.written ?? 0, st.size)
                    if (baseWritten + data.content.length > MAX_UPLOAD_BYTES) {
                        writtenTracker.delete(fullPath)
                        return rpcError('File too large (max 50MB)')
                    }

                    const fd = await open(fullPath, 'r+')  // 必须已存在，不截断
                    await fd.write(data.content, 0, data.content.length, data.offset)
                    await fd.close()

                    // 累计更新；完成（累计 >= totalSize）则清理 entry，避免 writtenTracker 无限增长
                    const newWritten = baseWritten + data.content.length
                    if (prev?.totalSize !== undefined && newWritten >= prev.totalSize) {
                        writtenTracker.delete(fullPath)
                    } else {
                        writtenTracker.set(fullPath, { written: newWritten, totalSize: prev?.totalSize })
                    }

                    return { success: true, written: data.content.length }
                } else {
                    return rpcError('Either filename (offset=0) or path (offset>0) is required')
                }
            } catch (error) {
                const nodeError = error as NodeJS.ErrnoException
                // 文件不存在（offset>0 但首块未写 / path 错）→ 明确错误
                if (nodeError.code === 'ENOENT') {
                    return rpcError('Upload file not found (offset out of order or invalid path)')
                }
                logger.debug('写入文件块失败:', error)
                return rpcError(getErrorMessage(error, 'Failed to write file range'))
            }
        },
    )

    // 删除上传文件
    rpcHandlerManager.registerHandler<DeleteUploadRequest, DeleteUploadResponse>(
        'deleteUpload',
        async (data) => {
            // 优先使用 RPC 参数中的 cwd，否则使用注册时的 workingDirectory
            const effectiveCwd = data.cwd || workingDirectory
            if (data.cwd && !validateRpcCwd(data.cwd)) {
                return rpcError('Invalid cwd: path is outside home directory')
            }

            const path = data?.path?.trim()
            if (!path) {
                return rpcError('Path is required')
            }

            // 校验路径在 uploads 目录内
            if (!isPathWithinUploads(effectiveCwd, path)) {
                return rpcError('Invalid upload path')
            }

            try {
                const fullPath = resolve(effectiveCwd, path)
                await rm(fullPath, { force: true })
                // 同步清理累计追踪 entry（删除 / 中断后失效，避免 stale entry 泄漏）
                writtenTracker.delete(fullPath)
                return { success: true }
            } catch (error) {
                logger.debug('删除上传文件失败:', error)
                return rpcError(getErrorMessage(error, 'Failed to delete upload file'))
            }
        },
    )

    // 同 path 原子替换上传（「编辑已有上传」场景，如画板重编辑换图）
    rpcHandlerManager.registerHandler<ReplaceUploadRequest, ReplaceUploadResponse>(
        'replaceUpload',
        async (data) => {
            // 优先使用 RPC 参数中的 cwd，否则使用注册时的 workingDirectory
            const effectiveCwd = data.cwd || workingDirectory
            if (data.cwd && !validateRpcCwd(data.cwd)) {
                return rpcError('Invalid cwd: path is outside home directory')
            }

            const path = data?.path?.trim()
            if (!path) {
                return rpcError('Path is required')
            }
            if (!(data.content instanceof Uint8Array) || data.content.length === 0) {
                return rpcError('Content is required')
            }
            if (data.content.length > MAX_UPLOAD_BYTES) {
                return rpcError('File too large (max 50MB)')
            }

            // 校验路径在 uploads 目录内 + 扩展名白名单（文件名不变 ⇒ 扩展簇不变，
            // 但 path 是客户端自报的，首发伪造仍要拦）
            if (!isPathWithinUploads(effectiveCwd, path)) {
                return rpcError('Invalid upload path')
            }
            const extError = validateFileExtension(basename(path))
            if (extError) return rpcError(extError)

            const fullPath = resolve(effectiveCwd, path)
            // 临时文件落目标同目录：同文件系统 rename 原子生效——任一时刻 path 要么完整
            // 旧内容要么完整新内容，写坏只伤临时文件（直接 open('w') 截断会把半截新内容
            // 留在被引用的正式 path 上，无法恢复）。源文件已不存在时 rename 照常创建，
            // 语义为幂等写入（replace 的目标 = 「该 path 持有新内容」）
            const tmpPath = `${fullPath}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`
            try {
                await mkdir(dirname(fullPath), { recursive: true })
                await writeFile(tmpPath, data.content)
                await rename(tmpPath, fullPath)
                // 内容已换血，累计追踪 entry 失效
                writtenTracker.delete(fullPath)
                return { success: true }
            } catch (error) {
                await rm(tmpPath, { force: true }).catch(() => {})
                logger.debug('替换上传文件失败:', error)
                return rpcError(getErrorMessage(error, 'Failed to replace upload file'))
            }
        },
    )
}
