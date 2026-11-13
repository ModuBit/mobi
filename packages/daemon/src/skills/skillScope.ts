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
 * scope 解析与路径派生（架构深化候选①⑦）：「一个 scope 的 skill 目录在哪、
 * 归属 settings 写到哪、CLI 进程跑在哪」的单一声明源。
 *
 * 此前这条知识散在 routes / skillCli / skillCreatePrompt / skillScanner 四处手拼
 * （模板字符串与 join() 混用，已现漂移）；本模块收拢后消费方只经 interface 取路径。
 * skills 专有命名——迭代 2（mcp）目录规则若同构，泛化只需搬文件改词。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SKILL_SCOPE_GLOBAL } from '@mobi/shared'

/** 视角：user 级（global tab）或某 workspace（project skill） */
export type SkillScope = { kind: 'global' } | { kind: 'workspace'; path: string }

/** scopeView 所需的最小根输入（SkillScanRoots 的结构子集；保持依赖单向：scanner → 本模块） */
export interface ScopeViewRoots {
    claudeConfigDir: string
}

/** resolveScope 四态：前两态可用，后两态由 HTTP 层翻译 404/400 */
export type ScopeResolution = SkillScope | { kind: 'not-found' } | { kind: 'no-folder' }

/** workspace 查询的最小消费面（SyncEngine.getWorkspace 的结构子集，保持本模块零 sync 依赖） */
export interface WorkspaceLike {
    folders: ReadonlyArray<{ path: string; primary: boolean }>
}

/**
 * workspaceId → 视角。多 folder workspace 以 primary folder 为扫描根
 * （CC 语义按 cwd 所在目录）；无 primary 标记时回退首个 folder。
 */
export function resolveScope(
    getWorkspace: (id: string) => WorkspaceLike | undefined,
    workspaceId: string,
): ScopeResolution {
    if (workspaceId === SKILL_SCOPE_GLOBAL) return { kind: 'global' }
    const workspace = getWorkspace(workspaceId)
    if (!workspace) return { kind: 'not-found' }
    const primary = workspace.folders.find(f => f.primary) ?? workspace.folders[0]
    if (!primary) return { kind: 'no-folder' }
    return { kind: 'workspace', path: primary.path }
}

/** CLI 进程 cwd：user 级 = home（配 -g 由 CLI 自动定位 user scope）；project 级 = workspace 根 */
export function cliCwd(scope: SkillScope): string {
    return scope.kind === 'global' ? homedir() : scope.path
}

/** 视角派生路径族（扫描/新建目标/untracked 删除校验/归属 settings/CLI cwd 共用） */
export function scopeView(roots: ScopeViewRoots, scope: SkillScope): {
    /** agent 目录下 skill 根（personal → claudeConfigDir/skills；project → <ws>/.claude/skills） */
    skillRoot: string
    /** 归属层 settings（user 级 → user settings；project → workspace project settings） */
    ownSettingsPath: string
    /** CLI 进程 cwd（cliCwd 的对象形态出口） */
    cliCwd: string
} {
    return {
        skillRoot: scope.kind === 'global'
            ? join(roots.claudeConfigDir, 'skills')
            : join(scope.path, '.claude', 'skills'),
        ownSettingsPath: scope.kind === 'global'
            ? join(roots.claudeConfigDir, 'settings.json')
            : join(scope.path, '.claude', 'settings.json'),
        cliCwd: cliCwd(scope),
    }
}
