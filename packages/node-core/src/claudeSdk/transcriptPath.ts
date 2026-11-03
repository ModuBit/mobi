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

import { join, resolve } from 'node:path'
import { resolveClaudeConfigDir } from './claudeConfigDir'

/**
 * Claude Code transcript 路径解析（单一实现）。
 *
 * 规则对齐 CC：`<config>/projects/<cwd 编码>/<nativeSessionId>.jsonl`，其中 cwd 编码是把
 * resolve 后的绝对路径里所有非字母数字字符替换为 `-`。session 侧的读写与 daemon 侧的
 * 删除必须读同一处——各写一份会让「删哪个文件」与「CC 实际落盘在哪」漂移。
 */

/** 工作目录 → CC 项目目录名（非字母数字一律替换为 '-'） */
export function encodeClaudeProjectDir(workingDirectory: string): string {
    return resolve(workingDirectory).replace(/[^a-zA-Z0-9]/g, '-')
}

/** 工作目录 → CC 项目目录绝对路径 */
export function getClaudeProjectPath(workingDirectory: string): string {
    return join(resolveClaudeConfigDir(), 'projects', encodeClaudeProjectDir(workingDirectory))
}

export type TranscriptPathFailure =
    /** 会话没有 native session id（未激活的 fork 等），没有 transcript 可言 */
    | 'missing-native-session-id'
    /** 会话行缺工作目录，无法定位项目目录 */
    | 'missing-working-directory'
    /** native session id 不是合法文件名（防路径穿越） */
    | 'invalid-native-session-id'

export type TranscriptPathResult =
    | { ok: true; path: string }
    | { ok: false; reason: TranscriptPathFailure }

/** native id 只允许文件名字符：CC 生成的是 UUID，分叉 id 同形 */
const NATIVE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * 解析会话 transcript 路径。失败返回结构化原因，不抛异常——调用方（删除 / 预检）
 * 需要把原因透给用户，而不是把异常抛成 500。
 */
export function resolveTranscriptPath(
    nativeSessionId: string | null | undefined,
    workingDirectory: string | null | undefined,
): TranscriptPathResult {
    if (!nativeSessionId) return { ok: false, reason: 'missing-native-session-id' }
    if (!NATIVE_SESSION_ID_PATTERN.test(nativeSessionId)) return { ok: false, reason: 'invalid-native-session-id' }
    if (!workingDirectory) return { ok: false, reason: 'missing-working-directory' }
    return { ok: true, path: join(getClaudeProjectPath(workingDirectory), `${nativeSessionId}.jsonl`) }
}
