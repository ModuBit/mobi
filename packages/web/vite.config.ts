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

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'

// 从环境变量读取配置，支持 profile 机制覆盖
const hubUrl = process.env.MOBI_API_URL || 'http://localhost:2222'
const webPort = parseInt(process.env.MOBI_WEB_PORT || '5173', 10)

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'prompt',
            // 使用自定义 SW 注册逻辑，禁用插件自动注入
            injectRegister: false,
            // 不生成静态 manifest 文件，由 Hub 动态提供
            manifest: false,
            workbox: {
                // 允许预缓存较大的 JS chunk（默认 2 MiB 不够）
                maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
                navigateFallback: null,
                globPatterns: ['**/*.{js,css,woff2,png,svg,ico,gif}'],
                runtimeCaching: [
                    {
                        // API 请求：始终走网络
                        urlPattern: /^\/api\/.*/,
                        handler: 'NetworkOnly',
                    },
                    {
                        // Socket.IO：始终走网络
                        urlPattern: /^\/socket\.io\/.*/,
                        handler: 'NetworkOnly',
                    },
                ],
            },
            devOptions: {
                enabled: true,
            },
        }),
    ],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    },
    server: {
        host: true,
        port: webPort,
        proxy: {
            '/api': hubUrl,
            '/socket.io': {
                target: hubUrl,
                ws: true
            },
            '/manifest.webmanifest': hubUrl,
        }
    }
})
