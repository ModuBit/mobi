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

import { create } from 'zustand'
import type { TeamMember, TeamTask } from '@mobi/shared'

interface TeamAgentsState {
    membersBySession: Map<string, TeamMember[]>
    tasksBySession: Map<string, TeamTask[]>
    teamNameBySession: Map<string, string>
    setTeamState: (sessionId: string, members: TeamMember[], tasks: TeamTask[], teamName: string | null) => void
    clearSession: (sessionId: string) => void
}

export const useTeamAgentsStore = create<TeamAgentsState>((set) => ({
    membersBySession: new Map(),
    tasksBySession: new Map(),
    teamNameBySession: new Map(),

    setTeamState: (sessionId, members, tasks, teamName) =>
        set((state) => {
            const nextMembers = new Map(state.membersBySession)
            const nextTasks = new Map(state.tasksBySession)
            const nextNames = new Map(state.teamNameBySession)
            if (members.length > 0) {
                nextMembers.set(sessionId, members)
            } else {
                nextMembers.delete(sessionId)
            }
            if (tasks.length > 0) {
                nextTasks.set(sessionId, tasks)
            } else {
                nextTasks.delete(sessionId)
            }
            if (teamName) {
                nextNames.set(sessionId, teamName)
            } else {
                nextNames.delete(sessionId)
            }
            return { membersBySession: nextMembers, tasksBySession: nextTasks, teamNameBySession: nextNames }
        }),

    clearSession: (sessionId) =>
        set((state) => {
            const nextMembers = new Map(state.membersBySession)
            const nextTasks = new Map(state.tasksBySession)
            const nextNames = new Map(state.teamNameBySession)
            nextMembers.delete(sessionId)
            nextTasks.delete(sessionId)
            nextNames.delete(sessionId)
            return { membersBySession: nextMembers, tasksBySession: nextTasks, teamNameBySession: nextNames }
        }),
}))

// 空数组常量，避免每次 selector 返回新引用导致 React 19 无限渲染
const EMPTY_MEMBERS: TeamMember[] = []
const EMPTY_TASKS: TeamTask[] = []

export function useTeamMembers(sessionId: string): TeamMember[] {
    return useTeamAgentsStore((state) => state.membersBySession.get(sessionId) ?? EMPTY_MEMBERS)
}

export function useTeamTasks(sessionId: string): TeamTask[] {
    return useTeamAgentsStore((state) => state.tasksBySession.get(sessionId) ?? EMPTY_TASKS)
}

export function useTeamName(sessionId: string): string | null {
    return useTeamAgentsStore((state) => state.teamNameBySession.get(sessionId) ?? null)
}
