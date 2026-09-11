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

import { createSessionScopedStore } from './createSessionScopedStore'
import type { ForegroundTaskItem } from '@mobi/shared/types'

// 空数组常量，避免每次 selector 返回新引用导致 React 19 无限渲染
const EMPTY_TASKS: ForegroundTaskItem[] = []

const store = createSessionScopedStore<ForegroundTaskItem[]>(EMPTY_TASKS)

export const useForegroundTasksStore = store.useStore

export function useForegroundTasks(sessionId: string): ForegroundTaskItem[] {
    return store.useSessionScoped(sessionId)
}
