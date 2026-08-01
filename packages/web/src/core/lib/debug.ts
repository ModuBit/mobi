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
 * 调试模式解锁状态
 *
 * 移动端没有原生 devtools console，调试能力（diag 埋点开关 / vConsole / 下载诊断数据等）
 * 统一收敛到「设置页调试区块」，但该区块默认隐藏——需在创建页连点品牌 Logo ≥5 次解锁
 * （连点入口与 vConsole 共用，vConsole 逻辑不变）。
 *
 * 解锁状态持久化到 localStorage（`mobi-debug-unlocked`），设置页据此展示调试区块。
 * 任何环境缺失 localStorage 都静默降级为「未解锁」，绝不抛错。
 */

const LS_UNLOCKED_KEY = 'mobi-debug-unlocked'

/** 读 localStorage 安全访问器（同 diag.ts getStore，任何环境缺失 localStorage 都降级返回 null） */
function getStore(): Storage | null {
    try {
        return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
    } catch {
        return null
    }
}

/** 是否已解锁调试模式（持久化标志，刷新/重开 PWA 后仍保留） */
export function isDebugUnlocked(): boolean {
    return getStore()?.getItem(LS_UNLOCKED_KEY) === '1'
}

/** 解锁调试模式（幂等，重复调用无副作用） */
export function unlockDebug(): void {
    try {
        getStore()?.setItem(LS_UNLOCKED_KEY, '1')
    } catch {
        // localStorage 满 / 隐私模式：忽略，功能不依赖此持久化
    }
}

/** 锁定调试模式（隐藏设置页调试区块；测试与显式关闭用） */
export function lockDebug(): void {
    try {
        getStore()?.removeItem(LS_UNLOCKED_KEY)
    } catch {
        // 忽略
    }
}
