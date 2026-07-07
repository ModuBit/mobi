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
import { theme, Spin, Progress, Tooltip } from 'antd'
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
    // 上传中或失败，使用原始文件名
    return attachment.file.name
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

/** 判断附件是否为图片类型（MIME 优先，扩展名兜底） */
function isImageAttachment(attachment: FileAttachment): boolean {
    if (attachment.file.type.startsWith('image/')) return true
    const ext = attachment.file.name.split('.').pop()?.toLowerCase() ?? ''
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
}: {
    attachment: FileAttachment
    onRemove: (id: string) => void
}) {
    const { token } = theme.useToken()
    const isImage = isImageAttachment(attachment)
    const isUploading = attachment.status === 'uploading'
    const isError = attachment.status === 'error'
    const displayName = getDisplayName(attachment)
    const fileSize = formatFileSize(attachment.file.size)
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
                    <ImageThumb attachment={attachment} />
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
                <Tooltip title={displayName}>
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
                </Tooltip>
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

/** 图片缩略图子组件：管理 objectURL 生命周期 */
const ImageThumb = memo(function ImageThumb({
    attachment,
}: {
    attachment: FileAttachment
}) {
    const { token } = theme.useToken()
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [imgError, setImgError] = useState(false)

    // 创建 / 清理 objectURL，避免内存泄漏
    useEffect(() => {
        const url = URL.createObjectURL(attachment.file)
        setPreviewUrl(url)
        setImgError(false)
        return () => URL.revokeObjectURL(url)
    }, [attachment.file])

    if (previewUrl && !imgError) {
        return (
            <img
                src={previewUrl}
                alt=""
                onError={() => setImgError(true)}
                style={{
                    width: THUMB_SIZE,
                    height: THUMB_SIZE,
                    objectFit: 'cover',
                    display: 'block',
                }}
            />
        )
    }

    // 图片加载失败回退
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
}

/**
 * 附件列表组件：统一卡片布局，保持上传顺序
 *
 * 图片左侧显示缩略图预览，非图片左侧显示彩色文件图标，
 * 右侧统一显示文件名 + 人性化大小。
 */
export const AttachmentList = memo(function AttachmentList(props: AttachmentListProps) {
    const { attachments, onRemove } = props

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
                />
            ))}
        </div>
    )
})
