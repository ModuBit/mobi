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
 * Mobi 品牌几何真源 —— 集中定义 "m" 标记与 "MOBI" 字标的 SVG 路径，
 * 供 Logo / AnimateLogo / MobiWordmark / MobiLockup 共享，避免几何分散多处。
 */

/** "m" 标记左半折线（viewBox 250×250），右半由 transform=translate(250,0) scale(-1,1) 镜像复用 */
export const MOBI_MARK_PATH =
    'M36.5 183 L36.5 74.62 A16 16 0 0 1 63.48 62.98 L105.8 102.91 ' +
    'A7 7 0 0 1 96.2 113.09 L65.68 84.3 A9 9 0 0 0 50.5 90.85 ' +
    'L50.5 183 A7 7 0 0 1 36.5 183 Z'

/**
 * "MOBI" 字标 7 条描边路径（viewBox 16 24 144 70 局部坐标）。
 * O 由圆角矩形转为等价 path，统一为 path 数组便于遍历渲染。
 */
export const MOBI_WORDMARK_PATHS: readonly string[] = [
    // M: 圆角拱顶 + 左右双腿
    'M23 86 V33 Q23 31 25 31 H50 Q52 31 52 33 V86',
    // M: 中间短竖
    'M37 32 V72',
    // O: 圆角矩形（x66 y31 w29 h55 rx5）
    'M71 31 H90 A5 5 0 0 1 95 36 V81 A5 5 0 0 1 90 86 H71 A5 5 0 0 1 66 81 V36 A5 5 0 0 1 71 31 Z',
    // B: 左侧连续竖线
    'M109 33 V85',
    // B: 上碗（仅右侧收圆角，左连竖线）
    'M109 33 Q109 31 111 31 H120 Q123 31 123 34 V56 Q123 59 120 59 H109',
    // B: 下碗（仅右侧收圆角，左连竖线）
    'M109 59 H135 Q138 59 138 62 V84 Q138 87 135 87 H111 Q109 87 109 85',
    // I: 竖线
    'M152 31 V86',
]
