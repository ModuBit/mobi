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
 * @novnc/novnc 1.x 的最小类型声明（包体无类型导出；只声明 mobi 用到的子集，
 * 其余属性随用随补——完整协议面见 noVNC 文档）
 */

declare module '@novnc/novnc' {
    export default class RFB {
        constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: Record<string, unknown>)
        scaleViewport: boolean
        viewOnly: boolean
        background: string
        resizeSession: boolean
        disconnect(): void
        sendKey(keysym: number | null, code: string | null, down?: boolean): void
        addEventListener(type: string, listener: (event: CustomEvent) => void): void
        removeEventListener(type: string, listener: (event: CustomEvent) => void): void
    }
}
