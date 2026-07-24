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
