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
 * 终端 ANSI SGR 颜色码转义序列（CSI ... m）。
 * 业务必要：CLI 输出含颜色码，前端展示前需剥离。
 * 就近标注 disable，保留全局 no-control-regex 告警能力（仅抑制此处业务必要序列）。
 */
// eslint-disable-next-line no-control-regex -- SGR 颜色码（终端协议，业务必要）
const ANSI_SGR_REGEX = /\x1B\[[0-9;]*m/g;

/** 剥离终端 ANSI SGR 颜色码（不影响光标移动等其他 CSI 序列） */
export function stripAnsi(text: string): string {
    return text.replace(ANSI_SGR_REGEX, "");
}
