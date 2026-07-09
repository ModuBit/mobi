import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'

const clearSpy = vi.fn()
vi.mock('@/core/hooks/useCachedInstance', () => ({
    clearCachedInstance: (key: string) => clearSpy(key),
    clearAllInstances: vi.fn(),
}))

import { clearSessionResources } from '@/core/lib/sessionResources'

describe('clearSessionResources', () => {
    beforeEach(() => {
        useWorkspaceStore.getState().clearAll()
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
})
