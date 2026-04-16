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
 * 最近使用的技能管理
 * 使用 localStorage 存储
 */

const STORAGE_KEY = 'mobi:recentSkills'
const MAX_SKILLS = 10

export interface RecentSkill {
    /** 技能名称 */
    name: string
    /** 技能描述 */
    description?: string
    /** 最后使用时间 */
    lastUsedAt: number
}

/**
 * 获取最近使用的技能列表
 */
export function getRecentSkills(): RecentSkill[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (!stored) return []
        return JSON.parse(stored) as RecentSkill[]
    } catch {
        return []
    }
}

/**
 * 添加技能到最近使用列表
 */
export function addRecentSkill(skill: { name: string; description?: string }): void {
    try {
        const skills = getRecentSkills()
        const now = Date.now()

        // 移除已存在的同名技能
        const filtered = skills.filter((s) => s.name !== skill.name)

        // 添加到开头
        const updated: RecentSkill[] = [
            { ...skill, lastUsedAt: now },
            ...filtered,
        ].slice(0, MAX_SKILLS)

        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    } catch {
        // 忽略存储错误
    }
}

/**
 * 清除最近使用的技能列表
 */
export function clearRecentSkills(): void {
    try {
        localStorage.removeItem(STORAGE_KEY)
    } catch {
        // 忽略存储错误
    }
}
