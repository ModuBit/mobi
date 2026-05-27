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
 * Agent 卡片配色方案
 * 基于 zinc 单色调体系，提供极低饱和度的色彩点缀
 */

/** 色调预设 — 低饱和、高灰度，与 zinc 体系融合 */
const HUES = [220, 260, 340, 30, 170, 290, 200, 15] as const

/** djb2 哈希，为同一 agent 名称生成稳定索引 */
function djb2(str: string): number {
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i)
    }
    return hash >>> 0
}

/**
 * 根据 agent 名称返回对应的 HSL 色调值
 * 同一名称总是返回相同色调
 */
function hueOf(name: string): number {
    return HUES[djb2(name) % HUES.length]
}

/** 亮色模式背景（极淡，接近 zinc-100 的色彩偏移） */
const LIGHT_SAT = 28
const LIGHT_LUM = 94

/** 暗色模式背景（极暗，接近 zinc-900 的色彩偏移） */
const DARK_SAT = 22
const DARK_LUM = 15

/**
 * 获取 agent 卡片背景色
 * @param name agent 标识（id / subagentType / description）
 * @param isDark 是否暗色模式
 */
export function agentCardBg(name: string, isDark: boolean): string {
    const h = hueOf(name)
    const s = isDark ? DARK_SAT : LIGHT_SAT
    const l = isDark ? DARK_LUM : LIGHT_LUM
    return `hsl(${h} ${s}% ${l}%)`
}
