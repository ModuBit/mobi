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
 * 从 agentState 折算 pendingRequestsCount。
 *
 * 列表缓存项是 SessionSummary 形状（无 agentState 字段，只有 pendingRequestsCount 计数），
 * 故 session-updated 带来的 agentState 需折算成计数写回，否则审批/ask 后 requests 已清空，
 * 列表圆点仍卡在橙色（详情页存完整 Session，有 agentState，不受影响）。
 */
export function derivePendingRequestsCount(agentState: unknown): number {
    if (!agentState || typeof agentState !== 'object') return 0
    const requests = (agentState as { requests?: Record<string, unknown> | null }).requests
    return requests ? Object.keys(requests).length : 0
}
