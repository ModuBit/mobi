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
    /** Shiki 高亮上限（< 此值高亮）*/
    textHighlight: 1 * 1024 * 1024,
    /** 纯文本上限（≥ 此值 → 下载）*/
    textPlain: 2 * 1024 * 1024,
    /** 图片直显上限（≥ 此值 → 下载，移动端位图安全）*/
    image: 5 * 1024 * 1024,
    /** PDF 查看上限（≥ 此值 → 下载）*/
    pdf: 10 * 1024 * 1024,
} as const

/** 浏览器原生支持的音视频扩展名（其余走下载） */
export const NATIVE_MEDIA_EXT = ['mp4', 'webm', 'ogg', 'ogv', 'mp3', 'wav', 'm4a', 'aac', 'opus']
