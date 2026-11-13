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

import { describe, expect, it } from 'bun:test'
import { homedir } from 'node:os'
import { SKILL_SCOPE_GLOBAL } from '@mobi/shared'
import { cliCwd, resolveScope, scopeView } from '../../../src/skills/skillScope'
import type { SkillScanRoots } from '../../../src/skills/skillScanner'

const roots: SkillScanRoots = {
    claudeConfigDir: '/home/tester/.claude',
    userLockPath: '/home/tester/.agents/.skill-lock.json',
    pluginDirs: [],
}

describe('resolveScope', () => {
    it('global 哨兵（shared 单源常量）解析为全局视角', () => {
        const scope = resolveScope(() => undefined, SKILL_SCOPE_GLOBAL)
        expect(scope).toEqual({ kind: 'global' })
    })

    it('未知 workspaceId → not-found', () => {
        const scope = resolveScope(() => undefined, 'ws-404')
        expect(scope).toEqual({ kind: 'not-found' })
    })

    it('workspace 无 folder → no-folder', () => {
        const scope = resolveScope(() => ({ folders: [] }), 'ws-empty')
        expect(scope).toEqual({ kind: 'no-folder' })
    })

    it('多 folder 取 primary（CC 语义按 cwd 所在目录）', () => {
        const scope = resolveScope(
            () => ({ folders: [{ path: '/w/secondary', primary: false }, { path: '/w/primary', primary: true }] }),
            'ws-multi',
        )
        expect(scope).toEqual({ kind: 'workspace', path: '/w/primary' })
    })

    it('无 primary 标记时回退首个 folder', () => {
        const scope = resolveScope(
            () => ({ folders: [{ path: '/w/first', primary: false }, { path: '/w/second', primary: false }] }),
            'ws-noprimary',
        )
        expect(scope).toEqual({ kind: 'workspace', path: '/w/first' })
    })
})

describe('cliCwd', () => {
    it('user 级 cwd = home（CLI -g 自动定位 user scope）', () => {
        expect(cliCwd({ kind: 'global' })).toBe(homedir())
    })

    it('project 级 cwd = workspace 根', () => {
        expect(cliCwd({ kind: 'workspace', path: '/w/primary' })).toBe('/w/primary')
    })
})

describe('scopeView 派生路径族', () => {
    it('global：skill 根 / user settings / home cwd', () => {
        const view = scopeView(roots, { kind: 'global' })
        expect(view).toEqual({
            skillRoot: '/home/tester/.claude/skills',
            ownSettingsPath: '/home/tester/.claude/settings.json',
            cliCwd: homedir(),
        })
    })

    it('workspace：skill 根 / project settings / workspace cwd', () => {
        const view = scopeView(roots, { kind: 'workspace', path: '/w/primary' })
        expect(view).toEqual({
            skillRoot: '/w/primary/.claude/skills',
            ownSettingsPath: '/w/primary/.claude/settings.json',
            cliCwd: '/w/primary',
        })
    })
})
