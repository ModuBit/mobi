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

import { createInterface } from 'node:readline'

/**
 * 是/否确认提示，回车默认 Yes
 */
export function askYesNo(question: string): Promise<boolean> {
    return new Promise((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        })
        rl.question(`${question} [Y/n] `, (answer) => {
            rl.close()
            const normalized = answer.trim().toLowerCase()
            resolve(normalized === '' || normalized === 'y' || normalized === 'yes')
        })
    })
}

/**
 * 文本输入提示，支持默认值
 */
export function askInput(question: string, defaultValue?: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        })
        const suffix = defaultValue ? ` [${defaultValue}]` : ''
        rl.question(`${question}${suffix} `, (answer) => {
            rl.close()
            const trimmed = answer.trim()
            resolve(trimmed === '' && defaultValue ? defaultValue : trimmed)
        })
    })
}

/**
 * 端口输入提示，校验 1-65535
 */
export function askPort(question: string, defaultValue: number): Promise<number> {
    return new Promise((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        })
        rl.question(`${question} [${defaultValue}] `, (answer) => {
            rl.close()
            const trimmed = answer.trim()
            if (trimmed === '') {
                resolve(defaultValue)
                return
            }
            const parsed = parseInt(trimmed, 10)
            if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
                resolve(parsed)
            } else {
                resolve(defaultValue)
            }
        })
    })
}

/**
 * 多选一提示
 */
export function askChoice(question: string, choices: { label: string; value: string }[]): Promise<string> {
    return new Promise((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        })

        const options = choices.map((c, i) => `  ${i + 1}. ${c.label}`).join('\n')
        rl.question(`${question}\n${options}\n> `, (answer) => {
            rl.close()
            const idx = parseInt(answer.trim(), 10) - 1
            if (idx >= 0 && idx < choices.length) {
                resolve(choices[idx].value)
            } else {
                resolve(choices[0].value)
            }
        })
    })
}
