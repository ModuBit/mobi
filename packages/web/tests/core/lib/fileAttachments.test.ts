/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 */

import { afterEach, describe, expect, it } from 'vitest'
import { attachmentMimeType, isImageFileAttachment } from '../../../src/core/lib/fileAttachments'
import type { FileAttachment } from '../../../src/core/lib/fileAttachments'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

/** 构造附件：恢复态占位 File = size 0 + type 空串（composerDrafts 恢复时的真实形态） */
function makeAttachment(overrides: {
    name: string
    fileSize?: number
    fileType?: string
    mimeType?: string
}): FileAttachment {
    const { name, fileSize = 0, fileType = '', mimeType } = overrides
    return {
        id: 'a1',
        name,
        file: new File([new ArrayBuffer(fileSize)], name, { type: fileType }),
        status: 'complete',
        ...(mimeType ? { mimeType } : {}),
    }
}

describe('isImageFileAttachment', () => {
    it('可靠 MIME 判图：正常上传的 png → true，pdf → false', () => {
        expect(isImageFileAttachment(makeAttachment({ name: 'a.png', fileType: 'image/png' }))).toBe(true)
        expect(isImageFileAttachment(makeAttachment({ name: 'r.pdf', fileType: 'application/pdf' }))).toBe(false)
    })

    it('恢复态占位 File（type 空串）按扩展名兜底判图', () => {
        // 回归锁定：EXT_TO_MIME 键必须与 getExtension 带点输出配套——曾因点号不匹配整条兜底失效
        expect(isImageFileAttachment(makeAttachment({ name: 'shot.png' }))).toBe(true)
        expect(isImageFileAttachment(makeAttachment({ name: 'photo.JPG' }))).toBe(true)
        expect(isImageFileAttachment(makeAttachment({ name: 'r.pdf' }))).toBe(false)
    })

    it('恢复态未知/无扩展名 → 非图片', () => {
        expect(isImageFileAttachment(makeAttachment({ name: 'data.bin' }))).toBe(false)
        expect(isImageFileAttachment(makeAttachment({ name: 'noext' }))).toBe(false)
    })

    it('恢复态顶层 MIME 存证优先：.tiff 未入 EXT_TO_MIME 但存证 image/tiff → 判图不错桶', () => {
        // 回归锁定：建模时 attachmentMimeType 记录的值在恢复侧必须被读回，
        // 否则占位 File 无 type + 扩展名不在映射表 → 桶从 images 翻转成 files
        const restored = makeAttachment({ name: 'scan.tiff', mimeType: 'image/tiff' })
        expect(isImageFileAttachment(restored)).toBe(true)
        expect(attachmentMimeType(restored)).toBe('image/tiff')
    })
})

describe('attachmentMimeType', () => {
    it('file.type 可靠时直用', () => {
        expect(attachmentMimeType(makeAttachment({ name: 'x.weird', fileType: 'image/webp' }))).toBe('image/webp')
    })

    it('恢复态按扩展名兜底映射 image MIME', () => {
        expect(attachmentMimeType(makeAttachment({ name: 'p.png' }))).toBe('image/png')
        expect(attachmentMimeType(makeAttachment({ name: 'doc.PDF' }))).toBe('application/pdf')
    })

    it('恢复态未知扩展回退 application/octet-stream', () => {
        expect(attachmentMimeType(makeAttachment({ name: 'mystery.xyz' }))).toBe('application/octet-stream')
        expect(attachmentMimeType(makeAttachment({ name: 'noext' }))).toBe('application/octet-stream')
    })
})
