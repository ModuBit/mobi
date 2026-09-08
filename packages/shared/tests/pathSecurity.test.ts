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

import { describe, it, expect } from 'vitest'
import {
    validateHomeDirPath,
    isWithinBlacklistedDir,
    isWithinDir,
    expandHomePath,
    validateReadPath,
    validateWritePath,
    DEFAULT_BLACKLISTED_DIR_NAMES,
} from '../src/pathSecurity'

const HOME = '/home/testuser'

describe('validateHomeDirPath', () => {
    it('home 内路径合法', () => {
        expect(validateHomeDirPath(`${HOME}/projects/app`, HOME).valid).toBe(true)
    })

    it('home 本身合法', () => {
        expect(validateHomeDirPath(HOME, HOME).valid).toBe(true)
    })

    it('home 外路径非法', () => {
        expect(validateHomeDirPath('/etc/passwd', HOME).valid).toBe(false)
    })

    it('homeDir 缺失非法', () => {
        expect(validateHomeDirPath('/x', '').valid).toBe(false)
    })
})

describe('isWithinBlacklistedDir', () => {
    it('默认黑名单目录直接命中', () => {
        expect(isWithinBlacklistedDir(`${HOME}/.ssh`, HOME)).toBe(true)
        expect(isWithinBlacklistedDir(`${HOME}/.config`, HOME)).toBe(true)
        expect(isWithinBlacklistedDir(`${HOME}/.mobi`, HOME)).toBe(true)
        expect(isWithinBlacklistedDir(`${HOME}/.claude`, HOME)).toBe(true)
    })

    it('默认黑名单覆盖全部目录名', () => {
        for (const name of DEFAULT_BLACKLISTED_DIR_NAMES) {
            expect(isWithinBlacklistedDir(`${HOME}/${name}`, HOME)).toBe(true)
        }
    })

    it('黑名单目录的子路径命中', () => {
        expect(isWithinBlacklistedDir(`${HOME}/.ssh/id_rsa`, HOME)).toBe(true)
        expect(isWithinBlacklistedDir(`${HOME}/.aws/credentials`, HOME)).toBe(true)
    })

    it('普通项目目录不命中', () => {
        expect(isWithinBlacklistedDir(`${HOME}/projects/myapp`, HOME)).toBe(false)
    })

    it('项目内同名目录不误伤（仅匹配 home 直接子级）', () => {
        expect(isWithinBlacklistedDir(`${HOME}/projects/myapp/.ssh`, HOME)).toBe(false)
        expect(isWithinBlacklistedDir(`${HOME}/work/.config`, HOME)).toBe(false)
    })

    it('homeDir 缺失返回 false', () => {
        expect(isWithinBlacklistedDir(`${HOME}/.ssh`, '')).toBe(false)
    })

    it('支持 MOBI_SEARCH_BLACKLIST 环境变量扩展', () => {
        const prev = process.env.MOBI_SEARCH_BLACKLIST
        process.env.MOBI_SEARCH_BLACKLIST = '.secrets,private'
        try {
            expect(isWithinBlacklistedDir(`${HOME}/.secrets`, HOME)).toBe(true)
            expect(isWithinBlacklistedDir(`${HOME}/private`, HOME)).toBe(true)
            // 默认黑名单仍然生效
            expect(isWithinBlacklistedDir(`${HOME}/.ssh`, HOME)).toBe(true)
        } finally {
            if (prev === undefined) delete process.env.MOBI_SEARCH_BLACKLIST
            else process.env.MOBI_SEARCH_BLACKLIST = prev
        }
    })
})

describe('isWithinDir', () => {
    it('base 内子路径 → true', () => {
        expect(isWithinDir('/proj/output/index.html', '/proj')).toBe(true)
    })
    it('恰好等于 base → true（含等）', () => {
        expect(isWithinDir('/proj', '/proj')).toBe(true)
    })
    it('../ 逃出 base → false', () => {
        expect(isWithinDir('/proj/../etc/passwd', '/proj')).toBe(false)
        expect(isWithinDir('/etc/passwd', '/proj')).toBe(false)
    })
    it('前缀同名但非目录前缀 → false（/project 不在 /proj 内）', () => {
        expect(isWithinDir('/project/x', '/proj')).toBe(false)
    })
    it('base 为空 → false', () => {
        expect(isWithinDir('/proj/x', '')).toBe(false)
    })
})

describe('expandHomePath', () => {
    it('裸 ~ → homeDir', () => {
        expect(expandHomePath('~', HOME)).toBe(HOME)
    })
    it('~/ 前缀 → homeDir 下解析', () => {
        expect(expandHomePath('~/notes/a.md', HOME)).toBe(`${HOME}/notes/a.md`)
    })
    it('~user 不展开（不支持多用户语义，按字面处理）', () => {
        expect(expandHomePath('~other/x', HOME)).toBe('~other/x')
    })
    it('非 ~ 开头原样返回', () => {
        expect(expandHomePath('src/a.ts', HOME)).toBe('src/a.ts')
        expect(expandHomePath('/abs/a.ts', HOME)).toBe('/abs/a.ts')
    })
    it('homeDir 为空时 ~ 路径原样返回（交给边界校验拒绝）', () => {
        expect(expandHomePath('~/x', '')).toBe('~/x')
    })
})

describe('validateReadPath（读边界：cwd 子树 ∪ home−黑名单）', () => {
    const CWD = '/home/testuser/proj'
    const OUTSIDE_CWD = '/tmp/sessions/proj'

    it('cwd 子树内相对/绝对路径 → 允许', () => {
        expect(validateReadPath('src/a.ts', CWD, HOME).valid).toBe(true)
        expect(validateReadPath(`${CWD}/src/a.ts`, CWD, HOME).valid).toBe(true)
        expect(validateReadPath(`${OUTSIDE_CWD}/src/a.ts`, OUTSIDE_CWD, HOME).valid).toBe(true)
    })

    it('home 子树（cwd 外）→ 允许', () => {
        expect(validateReadPath(`${HOME}/notes/a.md`, CWD, HOME).valid).toBe(true)
        expect(validateReadPath(`${HOME}/documents`, CWD, HOME).valid).toBe(true)
    })

    it('黑名单目录（home 直接子级）→ 拒绝，即使在 cwd 外的 home 内', () => {
        const r = validateReadPath(`${HOME}/.ssh/id_rsa`, CWD, HOME)
        expect(r.valid).toBe(false)
        expect(r.error).toContain('protected directory')
        expect(validateReadPath('~/.aws/credentials', CWD, HOME).valid).toBe(false)
    })

    it('cwd 恰为 home 时黑名单仍然生效（黑名单先于一切允许域）', () => {
        expect(validateReadPath('.ssh/id_rsa', HOME, HOME).valid).toBe(false)
        expect(validateReadPath(`${HOME}/.gnupg/x`, HOME, HOME).valid).toBe(false)
    })

    it('cwd 内项目子目录与黑名单同名不误伤（黑名单只匹配 home 直接子级）', () => {
        expect(validateReadPath('src/.config/settings.json', CWD, HOME).valid).toBe(true)
        expect(validateReadPath(`${CWD}/.mobi/uploads/a.pdf`, CWD, HOME).valid).toBe(true)
    })

    it('home 外路径 → 拒绝', () => {
        const r = validateReadPath('/etc/passwd', CWD, HOME)
        expect(r.valid).toBe(false)
        expect(r.error).toContain('outside the home directory')
    })

    it('../ 穿越逃出 cwd 且不在 home → 拒绝', () => {
        expect(validateReadPath('../../etc/passwd', CWD, HOME).valid).toBe(false)
    })

    it('home 兄弟目录 → 拒绝', () => {
        expect(validateReadPath('/home/other/x', CWD, HOME).valid).toBe(false)
    })

    it('~ 展开后按 home 边界判定', () => {
        expect(validateReadPath('~/notes/a.md', CWD, HOME).valid).toBe(true)
    })

    it('valid 结果携带展开后的绝对路径（校验对象 = 实际读取对象）', () => {
        const r = validateReadPath('~/notes/a.md', CWD, HOME)
        expect(r.valid).toBe(true)
        if (r.valid) expect(r.resolvedPath).toBe(`${HOME}/notes/a.md`)
        const abs = validateReadPath(`${CWD}/src/a.ts`, CWD, HOME)
        if (abs.valid) expect(abs.resolvedPath).toBe(`${CWD}/src/a.ts`)
    })

    it('homeDir 为空：仅 cwd 子树可用，~ 前缀显式拒绝（语义保留给 home 展开）', () => {
        expect(validateReadPath('src/a.ts', CWD, '').valid).toBe(true)
        expect(validateReadPath('/etc/passwd', CWD, '').valid).toBe(false)
        expect(validateReadPath('~/x', CWD, '').valid).toBe(false)
        expect(validateReadPath('~', CWD, '').valid).toBe(false)
    })
})

describe('validateWritePath（写边界：严格 cwd 子树）', () => {
    const CWD = '/home/testuser/proj'

    it('cwd 子树内路径 → 允许且携带 resolvedPath', () => {
        const r = validateWritePath('src/a.ts', CWD, HOME)
        expect(r.valid).toBe(true)
        if (r.valid) expect(r.resolvedPath).toBe(`${CWD}/src/a.ts`)
    })

    it('~ 前缀路径 → 拒绝（写边界严格 cwd，不做字面目录名写入）', () => {
        expect(validateWritePath('~/notes/a.md', CWD, HOME).valid).toBe(false)
    })

    it('homeDir 为空时 ~ 前缀同样显式拒绝', () => {
        expect(validateWritePath('~/x', CWD, '').valid).toBe(false)
    })

    it('../ 穿越逃出 cwd → 拒绝', () => {
        expect(validateWritePath('../outside.txt', CWD, HOME).valid).toBe(false)
    })
})
