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
 * runner controlServer 的 CLI 侧客户端（`mobi runner list / stop-session`）。
 *
 * ticket-22 收缩：旧的自重启协作族（checkIfRunnerRunningAndCleanupStaleState /
 * isRunnerRunningCurrentlyInstalledMobiVersion / stopRunner——依赖 runner.state.json
 * 的 pid/版本比对）随 runner mtime 自重启与独立 runner 进程一起删除；传输底座
 * 在 @mobi/node-core/utils/loopbackRunnerPost（读 daemon.state.json 的
 * runnerHttpPort 探活）。
 */

import { loopbackRunnerPost } from '@mobi/node-core/utils/loopbackRunnerPost';

async function runnerPost(path: string, body?: unknown): Promise<{ error?: string } | Record<string, unknown>> {
  return loopbackRunnerPost(path, body);
}

export async function listRunnerSessions(): Promise<unknown[]> {
  const result = await runnerPost('/list');
  const children = (result as { children?: unknown[] }).children;
  return children || [];
}

export async function stopRunnerSession(sessionId: string): Promise<boolean> {
  const result = await runnerPost('/stop-session', { sessionId });
  return (result as { success?: boolean }).success || false;
}
