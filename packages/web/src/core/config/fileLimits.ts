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

/** 统一文件大小阈值（P1-P7 共用）。文本看高亮 DOM 瓶颈，图片/PDF 看移动端解码内存 */
export const FILE_SIZE_LIMITS = {
    /** Shiki 高亮上限（< 此值高亮）。与 textPlain 同值：超限即下载，无中间档 */
    textHighlight: 2 * 1024 * 1024,
    /** 纯文本上限（≥ 此值 → 下载）*/
    textPlain: 2 * 1024 * 1024,
    /**
     * Markdown 上限（≥ 此值 → 下载）。markdown 由 TipTap/ProseMirror
     * 渲染（只读也挂编辑器，ADR 0004 渲染一致性裁决），PM 无虚拟化，大文档
     * 冻结风险高于 CodeMirror/代码高亮——2026-09-29 从 512KB 上调至与文本同档，
     * 若真机重现大 markdown 冻结再回调
     */
    markdown: 2 * 1024 * 1024,
    /** 图片直显上限（≥ 此值 → 下载，移动端位图安全）*/
    image: 5 * 1024 * 1024,
    /**
     * PDF 查看上限（≥ 此值 → 下载）。pdf.js 按页虚拟渲染，内存大头在「当前渲染页
     * 栅格」而非文件字节，20MB（约两三百页）移动端仍可承受；再大下载用系统查看器
     * 体验反而更好。2026-09-29 从 10MB 上调
     */
    pdf: 20 * 1024 * 1024,
} as const

/** 浏览器原生支持的音视频扩展名（其余走下载） */
export const NATIVE_MEDIA_EXT = ['mp4', 'webm', 'ogg', 'ogv', 'mp3', 'wav', 'm4a', 'aac', 'opus']
