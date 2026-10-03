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
 * remote 模式按键意图解析（ticket-23 从 ink useInput 处理器抽出，与 UI 框架无关）。
 *
 * 输入是 stdin 原始模式的 data chunk（可能一帧多键：粘贴/快速连击），输出逐键
 * 意图数组——语义对齐旧 ink useInput 回调的逐键处理（Ctrl-C / space / Kitty
 * key-release / 可打印字符清确认 / 其余转义序列忽略）。
 */

export type KeyIntent =
    /** Ctrl-C（\x03） */
    | { kind: 'exit' }
    /** 空格：含 Kitty 键盘协议的 CSI u 空格编码（ESC[32u / ESC[32;<mods>u） */
    | { kind: 'space' }
    /** Kitty key-release 序列（ESC[…:3u）：按住键的释放事件，须忽略以防误清确认 */
    | { kind: 'key-release' }
    /** 其他可打印字符：用于清除待确认状态 */
    | { kind: 'printable'; char: string }
    /** 其余控制/转义序列（方向键、功能键、单独 ESC 等） */
    | { kind: 'ignore' }

/** CSI u 序列：ESC[<codepoint>[;<mods>[:<event>…]]u */
// eslint-disable-next-line no-control-regex -- Kitty 键盘协议序列解析（ESC 转义，业务必要）
const CSI_U_RE = /^\u001b\[(\d+)((?:[:;]\d+(?::\d+)*)*)?u/
/** Kitty key-release（事件类型 3）：与旧 ink 处理器同一判定式，避免边界分歧 */
// eslint-disable-next-line no-control-regex -- Kitty 键盘协议序列解析（ESC 转义，业务必要）
const KEY_RELEASE_RE = /^\u001b\[[0-9;]*:3u$/

/**
 * 解析一个 stdin data chunk 为逐键意图序列。
 *
 * 拆分规则：\x03 独立成键；ESC 起头的 CSI u 序列整体成键（key-release / space /
 * ignore）；其余 ESC 序列简化为整段 ignore（remote 模式下不存在需要精确解析的
 * 非空格转义键）；\r/\n/\t 等控制字符忽略；可打印字符逐个成键。
 */
export function interpretKeyChunk(chunk: string): KeyIntent[] {
    const intents: KeyIntent[] = []
    let i = 0
    while (i < chunk.length) {
        const char = chunk[i]

        if (char === '\x03') {
            intents.push({ kind: 'exit' })
            i += 1
            continue
        }

        if (char === '\u001b') {
            const rest = chunk.slice(i)
            const csiUMatch = rest.match(CSI_U_RE)
            if (csiUMatch) {
                const sequence = csiUMatch[0]
                const codepoint = Number(csiUMatch[1])
                if (KEY_RELEASE_RE.test(sequence)) {
                    intents.push({ kind: 'key-release' })
                } else if (codepoint === 32) {
                    intents.push({ kind: 'space' })
                } else {
                    intents.push({ kind: 'ignore' })
                }
                i += sequence.length
                continue
            }
            // 其他转义序列（方向键 ESC[A、单独 ESC 等）：整段按一个 ignore
            intents.push({ kind: 'ignore' })
            i = chunk.length
            continue
        }

        if (char === ' ') {
            intents.push({ kind: 'space' })
            i += 1
            continue
        }

        // 控制字符（\r/\n/\t 等）无可打印语义，忽略；其余按可打印
        if (char >= ' ') {
            intents.push({ kind: 'printable', char })
        }
        i += 1
    }
    return intents
}
