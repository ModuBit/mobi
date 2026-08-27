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

import { describe, expect, it } from 'vitest'
import { prefetchRouteChunks, routeChunkLoaders } from '@/router'

describe('router 路由 chunk 加载器', () => {
    it('每个 loader 都能加载并导出声明的具名页面组件', async () => {
        for (const loader of Object.values(routeChunkLoaders)) {
            const mod = (await loader.load()) as Record<string, unknown>
            expect(mod[loader.pick], `${loader.pick} 应为具名导出的组件`).toBeTypeOf('function')
        }
    })

    it('prefetchRouteChunks 可重复调用且吞掉单个 chunk 的加载失败', async () => {
        await expect(prefetchRouteChunks()).resolves.toBeUndefined()
        await expect(prefetchRouteChunks()).resolves.toBeUndefined()
    })
})
