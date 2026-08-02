import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { usePromptSuggestionStore } from '@/core/data/stores/promptSuggestionStore'

const clearSpy = vi.fn()
vi.mock('@/core/hooks/useCachedInstance', () => ({
    clearCachedInstance: (key: string) => clearSpy(key),
    clearAllInstances: vi.fn(),
}))

import { clearSessionResources, clearAllSessionResources } from '@/core/lib/sessionResources'

describe('clearSessionResources', () => {
    beforeEach(() => {
        useWorkspaceStore.getState().clearAll()
        usePromptSuggestionStore.getState().clearAll()
        clearSpy.mockClear()
    })

    it('多终端：逐个按 terminal:${sid}:${tid} 清缓存，再清 store', () => {
        useWorkspaceStore.getState().openTerminalTab('s1') // tid A
        useWorkspaceStore.getState().openTerminalTab('s1') // tid B
        const tids = useWorkspaceStore.getState().getSession('s1').tabs.map((t) => t.terminalId!)

        clearSessionResources('s1')

        expect(clearSpy).toHaveBeenCalledTimes(2)
        tids.forEach((tid) => expect(clearSpy).toHaveBeenCalledWith(`terminal:s1:${tid}`))
        // store 已清
        expect(useWorkspaceStore.getState().sessions.has('s1')).toBe(false)
    })

    it('无终端时不调 clearCachedInstance', () => {
        useWorkspaceStore.getState().openFileTreeTab('s1')
        clearSessionResources('s1')
        expect(clearSpy).not.toHaveBeenCalled()
    })

    it('同步清理该 session 的瞬时建议', () => {
        usePromptSuggestionStore.getState().setSuggestion('s1', '下一轮建议')
        useWorkspaceStore.getState().openFileTreeTab('s1')
        clearSessionResources('s1')
        expect(usePromptSuggestionStore.getState().bySession.has('s1')).toBe(false)
    })
})

describe('clearAllSessionResources', () => {
    beforeEach(() => {
        useWorkspaceStore.getState().clearAll()
        usePromptSuggestionStore.getState().clearAll()
    })

    it('清空全部会话的瞬时建议(登出/换号不留残留)', () => {
        usePromptSuggestionStore.getState().setSuggestion('s1', '建议 A')
        usePromptSuggestionStore.getState().setSuggestion('s2', '建议 B')
        clearAllSessionResources()
        expect(usePromptSuggestionStore.getState().bySession.size).toBe(0)
    })
})
