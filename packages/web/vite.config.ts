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
import type { PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'
import mkcert from 'vite-plugin-mkcert'

// 从环境变量读取配置，支持 profile 机制覆盖
const hubUrl = process.env.MOBI_API_URL || 'http://localhost:2222'
const webPort = parseInt(process.env.MOBI_WEB_PORT || '5173', 10)

// MOBI_DEV_HTTPS=1 启用 HTTPS dev（用于移动端 PWA / Service Worker 测试）；
// vite-plugin-mkcert 自动生成受信任证书（含 localhost + 当前所有局域网 IP），IP 变化无需手动改证书。
// 启用方式：bun run dev:https（默认 bun run dev 走 HTTP，PC 开发无需 HTTPS）
const useHttpsDev = process.env.MOBI_DEV_HTTPS === '1' || process.env.MOBI_DEV_HTTPS === 'true'

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'prompt',
            // 使用自定义 SW 注册逻辑，禁用插件自动注入
            injectRegister: false,
            // 不生成静态 manifest 文件，由 Hub 动态提供
            manifest: false,
            // 自定义 SW:处理 push + notificationclick + 缓存
            strategies: 'injectManifest',
            srcDir: 'src/core/pwa',
            filename: 'sw.ts',
            injectManifest: {
                // 允许预缓存较大的 JS chunk（默认 2 MiB 不够）
                maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
                globPatterns: ['**/*.{js,css,woff2,png,svg,ico,gif}'],
            },
            // type:'module' 让 dev SW 走 esbuild 打包 sw.ts（含 push/notificationclick handler），
            // 与生产 injectManifest 一致；缺省时插件用 generateSW 合成无 push handler 的占位 SW
            devOptions: {
                enabled: true,
                type: 'module',
            },
        }),
        // 仅在启用 HTTPS dev 时加载 mkcert：force:true 每次启动重新生成证书，跟踪本机 IP 变化
        ...(useHttpsDev ? [mkcert({ force: true })] : []),
    ] as PluginOption[],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    },
    server: {
        host: true,
        port: webPort,
        // mkcert 插件在启用时自动填充 server.https 的 cert/key
        ...(useHttpsDev ? { https: true } : {}),
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
