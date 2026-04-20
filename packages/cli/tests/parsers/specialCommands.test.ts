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
import { parseCompact, parseClear, parseBash, parseSpecialCommand, checkDangerousCommand } from '@/parsers/specialCommands';

describe('parseCompact', () => {
    it('should parse /compact command with argument', () => {
        const result = parseCompact('/compact optimize the code');
        expect(result.isCompact).toBe(true);
        expect(result.originalMessage).toBe('/compact optimize the code');
    });

    it('should parse /compact command without argument', () => {
        const result = parseCompact('/compact');
        expect(result.isCompact).toBe(true);
        expect(result.originalMessage).toBe('/compact');
    });

    it('should not parse regular messages', () => {
        const result = parseCompact('hello world');
        expect(result.isCompact).toBe(false);
        expect(result.originalMessage).toBe('hello world');
    });

    it('should not parse messages that contain compact but do not start with /compact', () => {
        const result = parseCompact('please /compact this');
        expect(result.isCompact).toBe(false);
        expect(result.originalMessage).toBe('please /compact this');
    });
});

describe('parseClear', () => {
    it('should parse /clear command exactly', () => {
        const result = parseClear('/clear');
        expect(result.isClear).toBe(true);
    });

    it('should parse /clear command with whitespace', () => {
        const result = parseClear('  /clear  ');
        expect(result.isClear).toBe(true);
    });

    it('should not parse /clear with arguments', () => {
        const result = parseClear('/clear something');
        expect(result.isClear).toBe(false);
    });

    it('should not parse regular messages', () => {
        const result = parseClear('hello world');
        expect(result.isClear).toBe(false);
    });
});

describe('parseSpecialCommand', () => {
    it('should detect compact command', () => {
        const result = parseSpecialCommand('/compact optimize');
        expect(result.type).toBe('compact');
        expect(result.originalMessage).toBe('/compact optimize');
    });

    it('should detect clear command', () => {
        const result = parseSpecialCommand('/clear');
        expect(result.type).toBe('clear');
        expect(result.originalMessage).toBeUndefined();
    });

    it('should return null for regular messages', () => {
        const result = parseSpecialCommand('hello world');
        expect(result.type).toBeNull();
        expect(result.originalMessage).toBeUndefined();
    });

    it('should handle edge cases correctly', () => {
        // Test with extra whitespace
        expect(parseSpecialCommand('  /compact test  ').type).toBe('compact');
        expect(parseSpecialCommand('  /clear  ').type).toBe('clear');

        // Test partial matches should not trigger
        expect(parseSpecialCommand('some /compact text').type).toBeNull();
        expect(parseSpecialCommand('/compactor').type).toBeNull();
        expect(parseSpecialCommand('/clearing').type).toBeNull();
    });

    it('should detect bash command', () => {
        const result = parseSpecialCommand('! ls -la');
        expect(result.type).toBe('bash');
        expect(result.command).toBe('ls -la');
    });

    it('should trim bash command content', () => {
        const result = parseSpecialCommand('!   pwd   ');
        expect(result.type).toBe('bash');
        expect(result.command).toBe('pwd');
    });

    it('should not detect bare ! as bash', () => {
        expect(parseSpecialCommand('!').type).toBeNull();
        expect(parseSpecialCommand('! ').type).toBeNull();
        expect(parseSpecialCommand('!   ').type).toBeNull();
    });
});

describe('parseBash', () => {
    it('should parse ! with command', () => {
        const result = parseBash('! ls -la');
        expect(result.isBash).toBe(true);
        expect(result.command).toBe('ls -la');
    });

    it('should parse ! with leading/trailing whitespace', () => {
        const result = parseBash('  ! echo hello  ');
        expect(result.isBash).toBe(true);
        expect(result.command).toBe('echo hello');
    });

    it('should trim inner whitespace of command', () => {
        const result = parseBash('!   pwd');
        expect(result.isBash).toBe(true);
        expect(result.command).toBe('pwd');
    });

    it('should reject empty command after trim', () => {
        const result = parseBash('!   ');
        expect(result.isBash).toBe(false);
        expect(result.command).toBe('');
    });

    it('should reject bare exclamation', () => {
        expect(parseBash('!').isBash).toBe(false);
        expect(parseBash('hello ! world').isBash).toBe(false);
        expect(parseBash('').isBash).toBe(false);
    });

    it('should handle complex commands', () => {
        const result = parseBash('! git log --oneline -10');
        expect(result.isBash).toBe(true);
        expect(result.command).toBe('git log --oneline -10');
    });
});

describe('checkDangerousCommand', () => {
    // 高危命令应该被拦截
    const dangerousCases = [
        // 所有 rm 变体一律拦截
        ['rm file.txt', '文件删除操作'],
        ['rm -rf /', '文件删除操作'],
        ['rm -rf hub/src/config', '文件删除操作'],
        ['rm -rf ./node_modules', '文件删除操作'],
        ['rm -f specific-file.txt', '文件删除操作'],
        ['rm -rf /tmp/test-dir', '文件删除操作'],
        ['rm -fr /', '文件删除操作'],
        // 其他高危命令
        ['mkfs.ext4 /dev/sda1', '格式化文件系统'],
        ['dd if=/dev/zero of=/dev/sda', '直接写入磁盘设备'],
        ['chmod -R 777 /', '全局开放权限'],
        ['mv / /dev/null', '将根目录移至 null'],
    ] as const;

    it.each(dangerousCases)('should block dangerous command: %s', (cmd, expectedReason) => {
        const result = checkDangerousCommand(cmd);
        expect(result.isDangerous).toBe(true);
        expect(result.reason).toBe(expectedReason);
    });

    // 安全命令应该放行
    const safeCases = [
        'ls -la',
        'pwd',
        'git status',
        'echo hello world',
        'cat /etc/hosts',
        'docker ps',
        'npm install',
        'bun run build',
        'find . -name "*.ts"',
        'grep -r "pattern" src/',
        'chmod 755 script.sh',
        'mkdir new-dir',
        'touch file.txt',
        'cp src.txt dst.txt',
    ];

    it.each(safeCases)('should allow safe command: %s', (cmd) => {
        const result = checkDangerousCommand(cmd);
        expect(result.isDangerous).toBe(false);
        expect(result.reason).toBeNull();
    });

    it('should handle empty command', () => {
        const result = checkDangerousCommand('');
        expect(result.isDangerous).toBe(false);
    });
});