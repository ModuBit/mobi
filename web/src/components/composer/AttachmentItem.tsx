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

import { memo } from 'react'
import { Tag, theme, Spin } from 'antd'
import { CloseOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import type { FileAttachment } from '@/lib/fileAttachments'
import { isImageMimeType } from '@/lib/fileAttachments'

interface AttachmentItemProps {
    /** 附件信息 */
    attachment: FileAttachment
    /** 移除回调 */
    onRemove: (id: string) => void
}

/**
 * 附件项组件
 */
export const AttachmentItem = memo(function AttachmentItem(props: AttachmentItemProps) {
    const { attachment, onRemove } = props
    const { token } = theme.useToken()

    const isUploading = attachment.status === 'uploading'
    const isError = attachment.status === 'error'
    const isImage = isImageMimeType(attachment.file.type)

    return (
        <Tag
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                margin: 0,
                borderRadius: 8,
                background: token.colorFillSecondary,
                border: isError ? `1px solid ${token.colorErrorBorder}` : undefined
            }}
        >
            {/* 状态图标 */}
            {isUploading && <Spin size="small" />}
            {isError && (
                <ExclamationCircleOutlined
                    style={{ color: token.colorError }}
                />
            )}

            {/* 文件名 */}
            <span
                style={{
                    maxWidth: 150,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                }}
            >
                {attachment.file.name}
            </span>

            {/* 移除按钮 */}
            <CloseOutlined
                onClick={() => onRemove(attachment.id)}
                style={{
                    fontSize: 10,
                    color: token.colorTextSecondary,
                    cursor: 'pointer',
                    marginLeft: 4
                }}
            />
        </Tag>
    )
})

interface AttachmentListProps {
    /** 附件列表 */
    attachments: FileAttachment[]
    /** 移除回调 */
    onRemove: (id: string) => void
}

/**
 * 附件列表组件
 */
export const AttachmentList = memo(function AttachmentList(props: AttachmentListProps) {
    const { attachments, onRemove } = props

    if (attachments.length === 0) {
        return null
    }

    return (
        <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            padding: '8px 16px 0'
        }}>
            {attachments.map(attachment => (
                <AttachmentItem
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={onRemove}
                />
            ))}
        </div>
    )
})
