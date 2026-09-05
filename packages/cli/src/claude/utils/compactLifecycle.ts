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
 * compact started 信号幂等闸门。
 *
 * compact 开始信号有两个来源：
 * - 手动 /compact：specialCommand 触发（早于 SDK 实际开始压缩）
 * - 自动压缩：SDK `system:status {status:'compacting'}`（实测可与手动路径先后都到）
 *
 * 同一次压缩只应发一次 compact-started session event（web 据此进入压缩态），
 * 本闸门置位期间吞掉后续触发；终态（compact_boundary / compact-completed）时 reset，
 * 允许下一次压缩重新触发。
 */
export class CompactStartGate {
    private emitted = false

    /** 未发过则置位并返回 true（调用方据此发事件），已发过返回 false */
    shouldEmit(): boolean {
        if (this.emitted) return false
        this.emitted = true
        return true
    }

    /** 压缩终态时清位 */
    reset(): void {
        this.emitted = false
    }
}
