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

/**
 * 产物声明 directive 语义层（spec .scratch/inline-artifacts 票 01）
 *
 * 模型在 turn 最终回复输出 `:mobi-artifact{path="/abs/path" mode="card|wide"}`（字面量
 * 单源 shared ARTIFACT_DIRECTIVE，CLI 常驻契约文案共用）。语法/扫描/去重管线单源
 * domain/chat/directives，本模块注册 artifact 的参数语义与去重键，并单源收口
 * 「扩展名 → 产物类型」白名单与 inline 大小上限——渲染层（卡片/媒体/HTML）只消费
 * 判定结果，不各自罗列扩展名（Quality Issues 纪律：判定一处，引用多点）。
 * 全部纯函数、单 pass。
 */

import { ARTIFACT_DIRECTIVE, ARTIFACT_HTML_INLINE_LIMIT_MB } from '@mobi/shared'
import { DIRECTIVE_PREFIX, registerDirective } from './directives'
import type { DirectiveDefinition } from './directives'

/** artifact 指令在注册表中的名字（由 shared 字面量派生，ui 路由表按此寻址） */
export const ARTIFACT_DIRECTIVE_NAME = ARTIFACT_DIRECTIVE.slice(DIRECTIVE_PREFIX.length)

/** 展示意愿 mode：`card` 强制产物卡；`wide` 仅 HTML 放宽容器；缺省 = auto（web 按类型定） */
export type ArtifactMode = 'card' | 'wide'

/** 声明的类型化参数。mode 非法值按缺省 auto 处理（模型输出容错优先，不因拼写降级整条声明） */
export interface ArtifactParams {
    path: string
    mode?: ArtifactMode
}

/**
 * artifact 指令语义：path 必填（非空字符串），mode 仅接受 card/wide。
 * 非法（缺 path / 空 path）返回 null，消费方按原文诚实降级。
 * 去重键 = path：同一路径一条消息只保留首次声明（同一产物不重复渲染）。
 */
const ARTIFACT_DEFINITION: DirectiveDefinition<ArtifactParams> = {
    directive: ARTIFACT_DIRECTIVE,
    parse: (attrs) => {
        const { path, mode } = attrs
        if (path === undefined || path.trim() === '') return null
        return { path, mode: mode === 'card' || mode === 'wide' ? mode : undefined }
    },
    dedupeKey: (params) => params.path,
}

registerDirective(ARTIFACT_DEFINITION)

/** 从 MobiDirective 路由表拿到的原始 attrs → 类型化参数（渲染组件入口用；语义与注册 parse 同源） */
export function parseArtifactParams(attrs: Record<string, string>): ArtifactParams | null {
    return ARTIFACT_DEFINITION.parse(attrs)
}

/** 产物类型（按扩展名判定，判定权在 web——模型不写类型） */
export type ArtifactKind = 'image' | 'audio' | 'video' | 'html' | 'pdf' | 'unknown'

/** 扩展名 → 类型白名单（单源；mime 校验是 fileMeta 的存在性/大小的旁证，不重复建表） */
const EXTENSION_KINDS: Readonly<Record<string, ArtifactKind>> = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
    svg: 'image', bmp: 'image', ico: 'image', avif: 'image',
    mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio', aac: 'audio',
    mp4: 'video', webm: 'video', mov: 'video',
    html: 'html', htm: 'html',
    pdf: 'pdf',
}

/** inline 大小上限（字节）——spec Q10 定稿：图 8MB / 音视频 50MB / HTML 2MB，pdf/unknown 不 inline。
 *  HTML 的数值单源在 shared（ARTIFACT_HTML_INLINE_LIMIT_MB，skill 散文同源），其余仅 web 裁决使用 */
const MB = 1024 * 1024

export const ARTIFACT_INLINE_LIMIT_BYTES: Readonly<Record<Exclude<ArtifactKind, 'pdf' | 'unknown'>, number>> = {
    image: 8 * MB,
    audio: 50 * MB,
    video: 50 * MB,
    html: ARTIFACT_HTML_INLINE_LIMIT_MB * MB,
}

/** 路径扩展名 → 产物类型；无扩展名/未登记 → unknown（产物卡 + 「类型不支持」） */
export function resolveArtifactKind(path: string): ArtifactKind {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    // 无扩展名（lastIndexOf 命中 -1 时 slice(0) 是整串）或未登记都落 unknown
    if (ext === '' || ext === path) return 'unknown'
    return EXTENSION_KINDS[ext] ?? 'unknown'
}

/** 该类型是否可 inline（pdf/unknown 恒卡片；mode='card' 的意愿在渲染层叠加） */
export function isInlineCapableKind(kind: ArtifactKind): kind is Exclude<ArtifactKind, 'pdf' | 'unknown'> {
    return kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'html'
}

/** 产物卡降级原因（渲染层据此标注；与 i18n key 一一对应） */
export type ArtifactCardReason = 'missing' | 'too-large' | 'unsupported'
