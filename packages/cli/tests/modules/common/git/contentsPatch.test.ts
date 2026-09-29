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
 * contentsPatch 单测（真 git 集成）：合成 patch 头形状——临时目录前缀必须剥净
 * （modify / add / delete 三形态；add 时 git 把 a 侧路径也指到 b 目录，实证坑）。
 */

import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { synthesizeContentsPatch, type GitExec } from '@/modules/common/git/contentsPatch'
import { git } from '@/modules/common/git/gitExec'

const execFileAsync = promisify(execFile)

/** 真 git 执行（cwd/tmp 参数由 contentsPatch 控制） */
const realGit: GitExec = (cwd, args) => execFileAsync('git', args, { cwd }).then((r) => r.stdout)

describe('synthesizeContentsPatch（真 git 集成）', () => {
    it('modify：头为 a/<name> / b/<name>，无临时目录泄漏，正文含 +/- 行', async () => {
        const patch = await synthesizeContentsPatch(realGit, '/proj/app.ts', 'old\n', 'new\n')
        expect(patch).toContain('--- a/app.ts')
        expect(patch).toContain('+++ b/app.ts')
        expect(patch).toContain('-old')
        expect(patch).toContain('+new')
        expect(patch).not.toContain('mobi-review-patch-')
        expect(patch).not.toContain('/var/folders/')
        expect(patch).not.toContain('/tmp/')
    })

    it('add（before null）：a 侧 /dev/null，无临时目录泄漏（git 把 a 侧路径指向 b 目录的实证坑）', async () => {
        const patch = await synthesizeContentsPatch(realGit, '/proj/new.ts', null, 'fresh\n')
        expect(patch).toContain('new file mode')
        expect(patch).toContain('--- /dev/null')
        expect(patch).toContain('+++ b/new.ts')
        expect(patch).toContain('+fresh')
        expect(patch).not.toContain('mobi-review-patch-')
        expect(patch).not.toContain('/var/folders/')
        expect(patch).not.toContain('/tmp/')
    })

    it('delete（after null）：b 侧 /dev/null，无临时目录泄漏', async () => {
        const patch = await synthesizeContentsPatch(realGit, '/proj/gone.ts', 'bye\n', null)
        expect(patch).toContain('deleted file mode')
        expect(patch).toContain('--- a/gone.ts')
        expect(patch).toContain('+++ /dev/null')
        expect(patch).toContain('-bye')
        expect(patch).not.toContain('mobi-review-patch-')
    })

    it('两侧都 null：空串（无可合成）', async () => {
        await expect(synthesizeContentsPatch(git, '/proj/x.ts', null, null)).resolves.toBe('')
    })
})
