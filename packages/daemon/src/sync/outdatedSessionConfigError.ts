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
 * 会话进程回执里缺了刚下发的配置字段。
 *
 * 会话进程活得比 daemon 久：换二进制不重启会话时，CLI 侧跑的仍是加字段之前的代码，
 * `set-session-config` 会把不认识的字段原样忽略、只回它认识的几个。这不是传输错误，
 * 而是**对端版本落后**——唯一出路是重启会话让新二进制重新拉起进程，所以带结构化
 * code 供 web 选文案（不靠反解 message，改文案不会静默失效）。
 */
export class OutdatedSessionConfigError extends Error {
    readonly code = 'session_process_outdated'

    constructor(readonly fields: readonly string[]) {
        super(`Session process did not acknowledge ${fields.join(', ')}: it predates this setting. Restart the session to apply.`)
        this.name = 'OutdatedSessionConfigError'
    }
}
