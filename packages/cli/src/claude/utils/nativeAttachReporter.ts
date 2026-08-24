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
 * native session attach 上报器：native session id 变化时发射上报（首启 null→id 也算变化）。
 *
 * 场景：SDK 的 onSessionFound 可能对同一 id 多次触发（resume 回放、多轮 init），
 * 只有 id 真正变化（新会话、/clear、/compact 内部 fork）才需要 Hub 批量补写该会话
 * 缺 nativeSessionId 的消息行（messages-facts attached fact）。Hub 侧「只补空缺」
 * 本身幂等，此处去重只为省事件与日志噪音。
 */
export function createNativeAttachReporter(
    emit: (nativeSessionId: string) => void,
): (nativeSessionId: string) => void {
    let lastReported: string | null = null;
    return (nativeSessionId: string) => {
        if (lastReported === nativeSessionId) return;
        lastReported = nativeSessionId;
        emit(nativeSessionId);
    };
}
