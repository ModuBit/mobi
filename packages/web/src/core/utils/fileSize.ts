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
 * 文件大小人性化格式化（B → KB → MB → GB，1024 进制）。
 * 单位值 < 10 显示 1 位小数，否则取整；0 显示 "0 B"。
 */
export function formatFileSize(bytes: number): string {
    // 兜底：0 / 负数 / 非有限值（NaN/Infinity，防御异常 stat 输入）统一 "0 B"，避免 'NaN undefined'
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const value = bytes / 1024 ** i
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}
