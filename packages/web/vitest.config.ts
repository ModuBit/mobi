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

import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    test: {
        include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
        environment: 'jsdom',
        setupFiles: ['tests/setup.ts'],
        // 默认 5s 在全量并发下会被 CPU 饱和打爆（重渲染用例独占跑 1-4s，
        // 9 worker 满载时部分用例超 5s → 超时型 flaky）。15s 留足负载峰值余量；
        // 真正的死循环用例在 15s 下依然会超时暴露，不会掩盖
        testTimeout: 15_000,
        hookTimeout: 15_000,
    },
})
