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

import { memo, useState, useEffect, type FC } from 'react'
import { theme, Spin, Progress, Image } from 'antd'
import { AppTooltip } from '@/components/ui/AppTooltip'
import { buildMachineReadFileUrl, buildReadFileUrl } from '@/core/utils/fileUrl'
import { CloseOutlined, ExclamationCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import {
    File, FileText, FileSpreadsheet, FileImage, FileVideo,
    FileAudio, FileArchive, FileType, FileCode, FileCode2,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { FileAttachment } from '@/core/lib/fileAttachments'
import { formatFileSize } from '@/core/utils/fileSize'

/** 文件类别图标（对齐 AntX FileCard PresetIcons） */
type FileCategory = 'default' | 'pdf' | 'word' | 'excel' | 'ppt' | 'image' | 'video' | 'audio' | 'zip' | 'markdown' | 'java' | 'javascript' | 'python' | 'code'

const CATEGORY_ICON: Record<FileCategory, FC<LucideProps>> = {
    default: File,
    pdf: FileText,
    word: FileType,
    excel: FileSpreadsheet,
    ppt: FileType,
    image: FileImage,
    video: FileVideo,
    audio: FileAudio,
    zip: FileArchive,
    markdown: FileText,
    java: FileCode,
    javascript: FileCode2,
    python: FileCode2,
    code: FileCode,
}

/** 扩展名 → 文件类别 */
const EXT_CATEGORY: Record<string, FileCategory> = {
    pdf: 'pdf',
    doc: 'word', docx: 'word', rtf: 'word',
    xls: 'excel', xlsx: 'excel', csv: 'excel',
    ppt: 'ppt', pptx: 'ppt',
    zip: 'zip', tar: 'zip', gz: 'zip', bz2: 'zip', xz: 'zip', '7z': 'zip', rar: 'zip',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', ico: 'image',
    mp4: 'video', webm: 'video', mov: 'video', avi: 'video', mkv: 'video',
    mp3: 'audio', wav: 'audio', ogg: 'audio', aac: 'audio', flac: 'audio', m4a: 'audio',
    md: 'markdown', mdx: 'markdown',
    java: 'java', jar: 'java', kt: 'java', kts: 'java',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'javascript', tsx: 'javascript', mts: 'javascript', cts: 'javascript',
    py: 'python', pyw: 'python', pyi: 'python',
    // 其他代码文件 → 通用 code 类别
    go: 'code',
    rs: 'code',
    c: 'code', h: 'code', cpp: 'code', hpp: 'code', cc: 'code', cxx: 'code',
    cs: 'code',
    rb: 'code',
    php: 'code',
    swift: 'code',
    dart: 'code',
    lua: 'code',
    r: 'code',
    scala: 'code',
    sql: 'code',
    sh: 'code', bash: 'code', zsh: 'code',
    vue: 'code', svelte: 'code',
    yaml: 'code', yml: 'code',
    json: 'code', xml: 'code', toml: 'code', ini: 'code', conf: 'code',
    html: 'code', css: 'code', scss: 'code', less: 'code',
    txt: 'default',
    log: 'default',
    env: 'default',
    lock: 'default',
}

/** 类别对应的主题色 */
const CATEGORY_COLOR: Record<FileCategory, string> = {
    default: '#8c8c8c',
    pdf: '#f5222d',
    word: '#1677ff',
    excel: '#52c41a',
    ppt: '#fa8c16',
    image: '#eb2f96',
    video: '#722ed1',
    audio: '#13c2c2',
    zip: '#faad14',
    markdown: '#8c8c8c',
    java: '#f5222d',
    javascript: '#faad14',
    python: '#1677ff',
    code: '#597ef7',
}

/**
 * 从服务器路径提取文件名（取最后一段，移除 CLI 追加的短 ID）
 *
 * 当前格式：{原始文件名}-{shortId}.{ext}
 * 其中 shortId = Date.now().toString(36)(~8 位) + 4 位随机，约 12 个 base36 字符
 *
 * 旧格式（已弃用）：{timestamp}-{sanitized}.{ext}
 * timestamp 为 13 位纯数字前缀
 */
export function getDisplayName(attachment: FileAttachment): string {
    // 上传成功后，优先使用服务器返回的实际路径中的文件名
    if (attachment.path) {
        const parts = attachment.path.split('/')
        const serverName = parts[parts.length - 1]
        if (serverName) {
            // 旧格式优先（13位数字时间戳前缀）
            const legacyMatch = serverName.match(/^\d{13}-(.+)$/)
            if (legacyMatch) return legacyMatch[1]

            // 新格式：移除 base36 短 ID 后缀（-{shortId} 在扩展名之前，约 12 字符）
            const cleaned = serverName.replace(/-([a-z0-9]{10,14})(\.[a-z0-9]+)?$/i, '$2')
            return cleaned || serverName
        }
    }
    // 上传中或失败，使用原始文件名（恢复态优先顶层 name）
    return attachment.name ?? attachment.file.name
}

/** 根据文件名获取 Lucide 图标组件 */
function getFileIcon(filename: string): FC<LucideProps> {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const category = EXT_CATEGORY[ext] ?? 'default'
    return CATEGORY_ICON[category]
}

/** 根据文件名获取类别主题色 */
function getCategoryColor(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const category = EXT_CATEGORY[ext] ?? 'default'
    return CATEGORY_COLOR[category]
}

/** 判断附件是否为图片类型（MIME 优先，扩展名兜底；恢复态空 file 无可靠 MIME） */
function isImageAttachment(attachment: FileAttachment): boolean {
    const filename = attachment.name ?? attachment.file.name
    if (attachment.file.size > 0 && attachment.file.type.startsWith('image/')) return true
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    return EXT_CATEGORY[ext] === 'image'
}

/** 卡片左侧图标区尺寸 */
const THUMB_SIZE = 36

/**
 * 附件卡片组件：左侧预览图/图标 + 右侧文件名+大小 + 状态指示
 *
 * 统一布局，图片与非图片仅左侧内容不同：
 * - 图片：缩略图预览
 * - 非图片：彩色文件图标
 */
const AttachmentCard = memo(function AttachmentCard({
    attachment,
    onRemove,
    sessionId,
    machineId,
    cwd,
}: {
    attachment: FileAttachment
    onRemove: (id: string) => void
    /** 透传 ImageThumb：恢复态附件预览取数通道 */
    sessionId?: string
    machineId?: string
    cwd?: string
}) {
    const { token } = theme.useToken()
    const isImage = isImageAttachment(attachment)
    const isUploading = attachment.status === 'uploading'
    const isError = attachment.status === 'error'
    const displayName = getDisplayName(attachment)
    const fileSize = formatFileSize(attachment.size ?? attachment.file.size)
    const accentColor = getCategoryColor(displayName)

    return (
        <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            borderRadius: token.borderRadiusLG,
            border: `1px solid ${isError ? token.colorErrorBorder : token.colorBorderSecondary}`,
            background: isError ? token.colorErrorBg : token.colorBgContainer,
            maxWidth: 220,
            position: 'relative',
            // 错误状态左侧指示条
            ...(isError ? { borderLeft: `3px solid ${token.colorError}` } : {}),
        }}>
            {/* 左侧：预览图或文件图标 */}
            <div style={{
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                borderRadius: token.borderRadiusSM,
                overflow: 'hidden',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                background: isImage ? token.colorFillQuaternary : `${accentColor}10`,
            }}>
                {isImage ? (
                    <ImageThumb attachment={attachment} sessionId={sessionId} machineId={machineId} cwd={cwd} />
                ) : (
                    <FileIconSlot
                        attachment={attachment}
                        displayName={displayName}
                        accentColor={accentColor}
                    />
                )}

                {/* 上传中覆盖：有进度显示进度条，无进度（极小文件瞬间完成）回退 Spin */}
                {isUploading && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(255, 255, 255, 0.7)',
                        borderRadius: token.borderRadiusSM,
                    }}>
                        {attachment.progress ? (
                            <Progress type="circle" percent={attachment.progress} size={20} showInfo={false} />
                        ) : (
                            <Spin indicator={<LoadingOutlined style={{ fontSize: 14 }} spin />} />
                        )}
                    </div>
                )}

                {/* 错误覆盖 */}
                {isError && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: `${token.colorErrorBg}CC`,
                        borderRadius: token.borderRadiusSM,
                    }}>
                        <ExclamationCircleOutlined style={{ color: token.colorError, fontSize: 14 }} />
                    </div>
                )}
            </div>

            {/* 右侧：文件名 + 大小 */}
            <div style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
            }}>
                <AppTooltip title={displayName}>
                    <span style={{
                        fontSize: 12,
                        lineHeight: '16px',
                        fontWeight: 500,
                        color: isError ? token.colorError : token.colorText,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}>
                        {displayName}
                    </span>
                </AppTooltip>
                <span style={{
                    fontSize: 11,
                    lineHeight: '14px',
                    color: isError ? token.colorError : token.colorTextTertiary,
                }}>
                    {fileSize}
                </span>
            </div>

            {/* 移除按钮 */}
            <CloseOutlined
                onClick={() => onRemove(attachment.id)}
                style={{
                    fontSize: 10,
                    color: token.colorTextQuaternary,
                    cursor: 'pointer',
                    flexShrink: 0,
                    marginLeft: 2,
                    transition: 'color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = token.colorTextSecondary }}
                onMouseLeave={e => { e.currentTarget.style.color = token.colorTextQuaternary }}
            />
        </div>
    )
})

/** 图片缩略图子组件：管理 objectURL 生命周期；空 file（恢复态）直接回退图标 */
const ImageThumb = memo(function ImageThumb({
    attachment,
    sessionId,
    machineId,
    cwd,
}: {
    attachment: FileAttachment
    /** 会话 ID：machineId/cwd 缺失时的 session read-file 回退通道 */
    sessionId?: string
    /** 归属机器 ID：服务端路径优先经 machine 端点预览（会话关闭后仍可达） */
    machineId?: string
    /** 会话工作目录（machine 端点 cwd 参数） */
    cwd?: string
}) {
    const { token } = theme.useToken()
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [imgError, setImgError] = useState(false)

    // 本地 blob 预览：创建 / 清理 objectURL，避免内存泄漏
    useEffect(() => {
        if (attachment.file.size === 0) {
            setPreviewUrl(null)
            return
        }
        const url = URL.createObjectURL(attachment.file)
        setPreviewUrl(url)
        setImgError(false)
        return () => URL.revokeObjectURL(url)
    }, [attachment.file])

    // 预览 src 三级分流（与消息气泡 ImageView 同思路）：
    // 1) 有本地 file → objectURL（上传中 / 正常态）
    // 2) 恢复态空 file 且有 path：machineId+cwd 可得 → machine 端点；否则回退 session read-file
    // 3) 都没有（如新建会话页的恢复态）→ 回退图标
    const thumbSrc =
        previewUrl
        ?? (attachment.path
            ? machineId && cwd
                ? buildMachineReadFileUrl(machineId, cwd, attachment.path)
                : sessionId
                    ? buildReadFileUrl(sessionId, attachment.path)
                    : null
            : null)

    if (thumbSrc && !imgError) {
        // antd Image：36×36 缩略显示（width/height 定外层容器，cover 裁切经 styles.image 落 <img>），
        // preview 开启 → 点击放大看原图。onError 置 imgError 回退图标。
        return (
            <Image
                src={thumbSrc}
                alt=""
                width={THUMB_SIZE}
                height={THUMB_SIZE}
                styles={{ image: { objectFit: 'cover', display: 'block' } }}
                onError={() => setImgError(true)}
            />
        )
    }

    // 图片加载失败 / 恢复态且无任何可用取数通道 → 回退图标
    return <FileImage size={16} style={{ color: token.colorTextQuaternary }} />
})

/** 非图片文件图标子组件 */
const FileIconSlot = memo(function FileIconSlot({
    attachment,
    displayName,
    accentColor,
}: {
    attachment: FileAttachment
    displayName: string
    accentColor: string
}) {
    const isUploading = attachment.status === 'uploading'
    const isError = attachment.status === 'error'
    const Icon = !isUploading && !isError ? getFileIcon(displayName) : null

    if (!Icon) return null

    return <Icon size={18} style={{ color: accentColor, flexShrink: 0 }} />
})

interface AttachmentListProps {
    /** 附件列表 */
    attachments: FileAttachment[]
    /** 移除回调 */
    onRemove: (id: string) => void
    /** 会话 ID：图片附件缩略图预览的 session 回退通道（新建会话页无会话，不传） */
    sessionId?: string
    /** 归属机器 ID：恢复态附件优先 machine 端点预览 */
    machineId?: string
    /** 会话工作目录（machine 端点 cwd 参数） */
    cwd?: string
}

/**
 * 附件列表组件：统一卡片布局，保持上传顺序
 *
 * 图片左侧显示缩略图预览，非图片左侧显示彩色文件图标，
 * 右侧统一显示文件名 + 人性化大小。
 */
export const AttachmentList = memo(function AttachmentList(props: AttachmentListProps) {
    const { attachments, onRemove, sessionId, machineId, cwd } = props

    if (attachments.length === 0) {
        return null
    }

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 16px 0' }}>
            {attachments.map(attachment => (
                <AttachmentCard
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={onRemove}
                    sessionId={sessionId}
                    machineId={machineId}
                    cwd={cwd}
                />
            ))}
        </div>
    )
})
