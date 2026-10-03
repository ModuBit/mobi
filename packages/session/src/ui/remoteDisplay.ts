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
 * remote 模式纯文本展示 + 按键监听（ticket-23 替代 ink RemoteModeDisplay）。
 *
 * 替代原则：只保留信息，不保留交互动效——
 * - 消息流：messageBuffer 更新逐条 console.log（带 ANSI 颜色，对齐旧 UI 的
 *   user/assistant/system/tool/result/status 配色）
 * - 状态行：启动横幅（模式说明 + 按键提示 + DEBUG 日志路径）单行输出
 * - 按键交互：stdin 原始模式读取（不引新库），解析/确认语义单源在
 *   switchKeys / switchConfirmation（步骤 1 抽出并单测）
 */

import { MessageBuffer, type BufferedMessage } from './messageBuffer'
import { interpretKeyChunk } from './switchKeys'
import { createSwitchConfirmation, type SwitchConfirmationState } from './switchConfirmation'

export interface RemoteDisplayHandle {
    /** 摘除监听与订阅（不触发回调；终端状态恢复由调用方 terminalState 统一做） */
    detach(): void
}

export interface RemoteDisplayOptions {
    messageBuffer: MessageBuffer
    logPath?: string
    hasTTY: boolean
    onExit: () => void | Promise<void>
    onSwitchToLocal: () => void | Promise<void>
}

const MESSAGE_COLORS: Record<BufferedMessage['type'], string> = {
    user: '\x1b[35m',
    assistant: '\x1b[36m',
    system: '\x1b[34m',
    tool: '\x1b[33m',
    result: '\x1b[32m',
    status: '\x1b[90m',
}
const COLOR_RESET = '\x1b[0m'

/** 终端宽行折行（对齐旧 UI 的 maxLineLength 逻辑，折行不切 ANSI 色段——色只包行首） */
function wrapLine(line: string, maxWidth: number): string[] {
    if (line.length <= maxWidth) return [line]
    const chunks: string[] = []
    for (let i = 0; i < line.length; i += maxWidth) {
        chunks.push(line.slice(i, i + maxWidth))
    }
    return chunks
}

function printMessage(msg: BufferedMessage): void {
    const width = process.stdout.columns || 80
    const color = MESSAGE_COLORS[msg.type] ?? '\x1b[0m'
    const time = msg.timestamp.toLocaleTimeString()
    for (const line of msg.content.split('\n')) {
        for (const wrapped of wrapLine(line, Math.max(20, width - 12))) {
            console.log(`${color}[${time}]${COLOR_RESET} ${color}${wrapped}${COLOR_RESET}`)
        }
    }
}

/** 确认/动作状态变化时的提示行（替代旧底部确认模态） */
function printStateHint(state: SwitchConfirmationState, logPath?: string): void {
    if (state.actionInProgress === 'exiting') {
        console.log('Exiting...')
    } else if (state.actionInProgress === 'switching') {
        console.log('Switching to local mode...')
    } else if (state.confirmationMode === 'exit') {
        console.log('\x1b[31m⚠️  Press Ctrl-C again to exit completely\x1b[0m')
    } else if (state.confirmationMode === 'switch') {
        console.log('\x1b[33m⏸️  Press space again to switch to local mode\x1b[0m')
    }
    if (process.env.DEBUG && logPath) {
        console.log(`\x1b[90mDebug logs: ${logPath}\x1b[0m`)
    }
}

export function attachRemoteDisplay(opts: RemoteDisplayOptions): RemoteDisplayHandle {
    const { messageBuffer, logPath, hasTTY } = opts

    if (hasTTY) {
        console.clear()
        console.log('\x1b[1m📡 Remote Mode - Claude Messages\x1b[0m')
        console.log('─'.repeat(Math.min((process.stdout.columns || 80) - 4, 60)))
        console.log('📱 Press space to switch to local mode • Ctrl-C to exit')
    }

    const unsubscribe = messageBuffer.onUpdate((messages) => {
        // 增量打印：MessageBuffer 每次通知携带全量，只打新增尾部（游标单源在此）
        for (const msg of messages.slice(printedCount)) {
            printMessage(msg)
        }
        printedCount = messages.length
    })
    let printedCount = 0

    const controls = createSwitchConfirmation({
        onExit: opts.onExit,
        onSwitch: opts.onSwitchToLocal,
    })

    const onData = hasTTY
        ? (chunk: Buffer | string): void => {
              const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
              const before = controls.getState()
              for (const intent of interpretKeyChunk(text)) {
                  controls.feed(intent)
              }
              const after = controls.getState()
              if (
                  after.confirmationMode !== before.confirmationMode ||
                  after.actionInProgress !== before.actionInProgress
              ) {
                  printStateHint(after, logPath)
              }
          }
        : null

    if (onData) {
        process.stdin.on('data', onData)
    }

    return {
        detach() {
            unsubscribe()
            controls.dispose()
            if (onData) {
                process.stdin.off('data', onData)
            }
            messageBuffer.clear()
        },
    }
}
