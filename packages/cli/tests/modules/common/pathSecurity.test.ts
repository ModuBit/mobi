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

import { describe, it, expect } from 'vitest';
import { validatePath, validateHomeDirPath } from '@/modules/common/pathSecurity';

describe('validatePath', () => {
    const workingDir = '/home/user/project';

    it('should allow paths within working directory', () => {
        expect(validatePath('/home/user/project/file.txt', workingDir).valid).toBe(true);
        expect(validatePath('file.txt', workingDir).valid).toBe(true);
        expect(validatePath('./src/file.txt', workingDir).valid).toBe(true);
    });

    it('should reject paths outside working directory', () => {
        const result = validatePath('/etc/passwd', workingDir);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('outside the working directory');
    });

    it('should prevent path traversal attacks', () => {
        const result = validatePath('../../.ssh/id_rsa', workingDir);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('outside the working directory');
    });

    it('should correctly handle working directory at filesystem root', () => {
        const rootDir = '/'
        expect(validatePath('/etc/passwd', rootDir).valid).toBe(true);
        expect(validatePath('etc/passwd', rootDir).valid).toBe(true);
    });

    it('should not treat sibling directories as inside working directory', () => {
        const result = validatePath('/home/user/project2/file.txt', workingDir);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('outside the working directory');
    });

    it('should allow the working directory itself', () => {
        expect(validatePath('.', workingDir).valid).toBe(true);
        expect(validatePath(workingDir, workingDir).valid).toBe(true);
    });
});

describe('validateHomeDirPath', () => {
    const homeDir = '/home/user'

    it('允许 homeDir 内的路径', () => {
        expect(validateHomeDirPath('/home/user/projects', homeDir).valid).toBe(true)
        expect(validateHomeDirPath('/home/user', homeDir).valid).toBe(true)
    })

    it('拒绝 homeDir 外的路径', () => {
        const result = validateHomeDirPath('/etc/passwd', homeDir)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('outside the home directory')
    })

    it('阻止路径穿越攻击', () => {
        const result = validateHomeDirPath('/home/user/../../etc/passwd', homeDir)
        expect(result.valid).toBe(false)
    })

    it('拒绝同级目录', () => {
        expect(validateHomeDirPath('/home/other', homeDir).valid).toBe(false)
    })

    it('homeDir 为空时拒绝', () => {
        const result = validateHomeDirPath('/home/user', '')
        expect(result.valid).toBe(false)
    })
})
