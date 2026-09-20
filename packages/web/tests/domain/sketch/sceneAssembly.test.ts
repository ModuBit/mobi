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
 * 场景装配测试：theme 剥离重灌与文件提取——锁住「重编辑必须跟随应用主题」
 * 的领域知识（见 sceneAssembly 模块文档）。
 */

import { describe, expect, it } from 'vitest'
import { prepareSceneUpdate } from '@/domain/sketch/sceneAssembly'

describe('prepareSceneUpdate 场景装配', () => {
    it('剥离内嵌 theme，按传入的应用主题重灌（dark 下开成 dark）', () => {
        const scene = {
            elements: [{ type: 'freedraw' }],
            appState: { theme: 'light', viewBackgroundColor: '#ffffff', exportBackground: true },
            files: {},
        }
        const { update } = prepareSceneUpdate(scene, 'dark')
        expect(update.appState.theme).toBe('dark')
        // 其余 appState 字段原样保留
        expect(update.appState.viewBackgroundColor).toBe('#ffffff')
        expect(update.appState.exportBackground).toBe(true)
        expect(update.elements).toBe(scene.elements)
    })

    it('内嵌 theme 缺省时同样按应用主题补齐', () => {
        const scene = { elements: [], appState: { viewBackgroundColor: '#fafafa' }, files: {} }
        const { update } = prepareSceneUpdate(scene, 'light')
        expect(update.appState.theme).toBe('light')
    })

    it('提取文件字典值为数组（空场景 → 空数组，调用方据此跳过 addFiles）', () => {
        const bg = { id: 'bg-1', mimeType: 'image/png' }
        const scene = { elements: [], appState: {}, files: { 'bg-1': bg } }
        const { files } = prepareSceneUpdate(scene, 'light')
        expect(files).toEqual([bg])
        expect(prepareSceneUpdate({ elements: [], appState: {}, files: {} }, 'light').files).toEqual([])
    })
})
