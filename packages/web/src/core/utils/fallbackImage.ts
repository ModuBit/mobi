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
 * 图片加载失败兜底图：语言无关的「破损图片」SVG（灰色山+太阳占位）。
 * data URI 内联，无需额外网络请求。文件预览（ImageContentView）与消息气泡
 * （UserBlocksView）共用同一视觉，改动只动这一处。
 */
export const FALLBACK_IMAGE = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='180' viewBox='0 0 240 180'>
        <rect width='240' height='180' fill='#f5f5f5'/>
        <path d='M30 130 L90 70 L130 110 L170 60 L210 130 Z' fill='#d9d9d9'/>
        <circle cx='175' cy='55' r='14' fill='#bfbfbf'/>
    </svg>`,
)}`
