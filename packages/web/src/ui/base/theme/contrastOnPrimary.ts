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
 * colorPrimary 之上的可读前景色：按 WCAG 亮度公式（YIQ）派生黑/白——mobi 双档
 * primary 一深一浅，消费方若硬编码白字在暗档会白底白字（2026-10-11 番茄钟实踩、
 * 2026-10-19 openui 按钮同病）。base/theme 收口此派生，消费方：
 * sandboxAppHost（--mobi-on-primary 注入）与 openui/theme（textAccentPrimary 覆写）
 * 是同一契约的多端。
 */

/** YIQ 亮度阈值：≥160 视为浅色 → 配深字，否则配白字 */
const YIQ_LIGHT_THRESHOLD = 160

export function contrastOnPrimary(primary: string): string {
    const hex = primary.replace('#', '')
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    const int = Number.parseInt(full, 16)
    if (Number.isNaN(int)) return '#fff'
    const r = (int >> 16) & 0xff
    const g = (int >> 8) & 0xff
    const b = int & 0xff
    return ((r * 299 + g * 587 + b * 114) / 1000 >= YIQ_LIGHT_THRESHOLD ? '#1f1f1f' : '#fff')
}
