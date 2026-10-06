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
 * executor controlServer 的 CLI 侧客户端（`mobi sessions list / stop`）。
 *
 * 历史（ticket-22 前后）：旧的自重启协作族（依赖 runner.state.json 的 pid/版本
 * 比对）已随独立 runner 进程一起删除；传输底座在
 * @mobi/node-core/utils/loopbackControlPost（读 daemon.state.json 的 controlPort 探活）。
 */

import { loopbackControlPost } from '@mobi/node-core/utils/loopbackControlPost';

async function executorPost(path: string, body?: unknown): Promise<{ error?: string } | Record<string, unknown>> {
  return loopbackControlPost(path, body);
}

export async function listExecutorSessions(): Promise<unknown[]> {
  const result = await executorPost('/list');
  const children = (result as { children?: unknown[] }).children;
  return children || [];
}

export async function stopExecutorSession(sessionId: string): Promise<boolean> {
  const result = await executorPost('/stop-session', { sessionId });
  return (result as { success?: boolean }).success || false;
}
