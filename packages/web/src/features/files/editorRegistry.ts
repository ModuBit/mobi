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
 * 编辑器实例注册表（模块级 Map，非响应式）。
 *
 * 关 tab 时需要：① 查该 tab 是否有未保存编辑（isDirty）② 触发 flush 保存（saveNow）。
 * useFileEditor 状态在 FileContentView 内（hook），InspectorPane 无法直接读，
 * 故 FileContentView mount 时把 editor api（经 ref 持有最新值）注册到此处，
 * InspectorPane closeTab 时查表。
 *
 * 非响应式：关 tab 是用户主动操作，读当前值即可，无需订阅 re-render。
 */

export interface EditorApi {
    /** 立即保存（flush debounce）；返回是否成功（无冲突） */
    saveNow: () => Promise<{ ok: boolean }>
    /** 是否有未保存编辑（读最新，避免闭包 stale） */
    isDirty: () => boolean
}

const editors = new Map<string, EditorApi>()

export function registerEditor(tabId: string, api: EditorApi): void {
    editors.set(tabId, api)
}

export function unregisterEditor(tabId: string): void {
    editors.delete(tabId)
}

export function getEditorApi(tabId: string): EditorApi | undefined {
    return editors.get(tabId)
}
