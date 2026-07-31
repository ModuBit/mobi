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

import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import { router } from './router'
import { ThemeProvider } from './core/config/theme/ThemeProvider'
import { initDiag } from './core/lib/diag'
import './index.css'

// 渲染链路诊断埋点：默认关，?diag=1 或 localStorage 开启；窗口挂 window.__mobiDiag
initDiag()

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            gcTime: 10 * 60_000,
            retry: 2,
        }
    }
})

// 移动端调试面板（vConsole）：通过连点 NewSessionPage 品牌 Icon ≥5 次开启
// 见 core/lib/vconsole.ts，桌面端不启用，未开启时不进 bundle

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <HelmetProvider>
            <ThemeProvider>
                <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                </QueryClientProvider>
            </ThemeProvider>
        </HelmetProvider>
    </React.StrictMode>
)
