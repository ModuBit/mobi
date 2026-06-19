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
 * Parsers for special commands that require dedicated remote session handling
 */

// 高危命令检测规则
// 每条规则包含匹配正则和危险等级描述
const DANGEROUS_COMMAND_RULES: ReadonlyArray<{
    pattern: RegExp
    reason: string
}> = [
    // 文件删除：所有 rm 命令一律拦截
    { pattern: /\brm\b/, reason: '文件删除操作' },
    // 格式化文件系统
    { pattern: /\bmkfs\b/, reason: '格式化文件系统' },
    // 直接写磁盘设备
    { pattern: /\bdd\s+.*of=\/dev\//, reason: '直接写入磁盘设备' },
    // fork bomb
    { pattern: /:\(\)\{\s*:\|:&\s*\};:/, reason: 'Fork bomb' },
    // 全局权限开放
    { pattern: /\bchmod\s+.*-R\s+777\s+\/\s*$/, reason: '全局开放权限' },
    // 覆写磁盘设备
    { pattern: />\s*\/dev\/sd[a-z]/, reason: '覆写磁盘设备' },
    // 将根目录移至 null
    { pattern: /\bmv\s+\/\s+\/dev\/null/, reason: '将根目录移至 null' },
    // 强制移动覆盖系统目录
    { pattern: /\bmv\s+.*-f.*\s+\/(etc|bin|sbin|usr|var|boot)\b/, reason: '覆盖系统目录' },
]

export interface DangerousCheckResult {
    isDangerous: boolean
    reason: string | null
}

/**
 * 检测命令是否包含高危操作
 * 返回危险等级和原因描述
 */
export function checkDangerousCommand(command: string): DangerousCheckResult {
    for (const rule of DANGEROUS_COMMAND_RULES) {
        if (rule.pattern.test(command)) {
            return { isDangerous: true, reason: rule.reason }
        }
    }
    return { isDangerous: false, reason: null }
}

export interface CompactCommandResult {
    isCompact: boolean;
    originalMessage: string;
}

export interface ClearCommandResult {
    isClear: boolean;
}

export interface BashCommandResult {
    isBash: boolean;
    command: string;
}

export interface SpecialCommandResult {
    type: 'compact' | 'clear' | 'bash' | null;
    originalMessage?: string;
    command?: string;
}

/**
 * Parse /compact command
 * Matches messages starting with "/compact " or exactly "/compact"
 */
export function parseCompact(message: string): CompactCommandResult {
    const trimmed = message.trim();
    
    if (trimmed === '/compact') {
        return {
            isCompact: true,
            originalMessage: trimmed
        };
    }
    
    if (trimmed.startsWith('/compact ')) {
        return {
            isCompact: true,
            originalMessage: trimmed
        };
    }
    
    return {
        isCompact: false,
        originalMessage: message
    };
}

/**
 * Parse /clear command
 * Only matches exactly "/clear"
 */
export function parseClear(message: string): ClearCommandResult {
    const trimmed = message.trim();
    
    return {
        isClear: trimmed === '/clear'
    };
}

/**
 * Parse ! command (bash mode)
 * 检测 "! command" 格式：! 必须是第一个字符，后跟空格，空格后为命令内容
 * 命令内容会 trim 两端空白；空命令（仅空格）不匹配
 */
export function parseBash(message: string): BashCommandResult {
    const trimmed = message.trim();

    if (trimmed.startsWith('! ')) {
        const command = trimmed.slice(2).trim()
        if (command.length > 0) {
            return {
                isBash: true,
                command,
            };
        }
    }

    return {
        isBash: false,
        command: '',
    };
}

/**
 * Unified parser for special commands
 * Returns the type of command and original message if applicable
 */
export function parseSpecialCommand(message: string): SpecialCommandResult {
    const compactResult = parseCompact(message);
    if (compactResult.isCompact) {
        return {
            type: 'compact',
            originalMessage: compactResult.originalMessage
        };
    }

    const clearResult = parseClear(message);
    if (clearResult.isClear) {
        return {
            type: 'clear'
        };
    }

    const bashResult = parseBash(message);
    if (bashResult.isBash) {
        return {
            type: 'bash',
            command: bashResult.command
        };
    }

    return {
        type: null
    };
}