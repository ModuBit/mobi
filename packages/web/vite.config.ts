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
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { cpSync, existsSync, readFileSync, statSync } from 'fs'
import { VitePWA } from 'vite-plugin-pwa'
import mkcert from 'vite-plugin-mkcert'
import { visualizer } from 'rollup-plugin-visualizer'
import { readMobiVersion } from './src/core/lib/version'

// 从环境变量读取配置，支持 profile 机制覆盖
const hubUrl = process.env.MOBI_API_URL || 'http://localhost:2222'
const webPort = parseInt(process.env.MOBI_WEB_PORT || '5173', 10)

// mobi 产品版本：构建期从 cli package.json 读取（与 `mobi --version` 同源），注入为全局常量
const mobiVersion = readMobiVersion(resolve(__dirname, '../cli/package.json'))

// MOBI_DEV_HTTPS=1 启用 HTTPS dev（用于移动端 PWA / Service Worker 测试）；
// vite-plugin-mkcert 自动生成受信任证书（含 localhost + 当前所有局域网 IP），IP 变化无需手动改证书。
// 启用方式：bun run dev:https（默认 bun run dev 走 HTTP，PC 开发无需 HTTPS）
const useHttpsDev = process.env.MOBI_DEV_HTTPS === '1' || process.env.MOBI_DEV_HTTPS === 'true'

// MOBI_BUNDLE_ANALYZE=1 时生成 dist/stats.html（bundle 体积 treemap），供体积分析；日常构建不跑
const enableBundleAnalyze = process.env.MOBI_BUNDLE_ANALYZE === '1'

/** 画板字体的静态服务前缀（dev middleware 与构建产物同路径，见 excalidrawAssetsPlugin） */
const EXCALIDRAW_ASSETS_PREFIX = '/excalidraw-assets/'
/** 包内 excalidraw 产物根（fonts 的父目录）：EXCALIDRAW_ASSET_PATH 前缀与磁盘的映射基准。
 *  excalidraw 自行拼接 fonts/ 前缀，故 URL /excalidraw-assets/fonts/X ↔ 磁盘 prod/fonts/X */
const EXCALIDRAW_ASSETS_ROOT = resolve(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod')

/**
 * excalidraw 字体自托管（离线/内网无 CDN，spec 05）：
 * - 构建：closeBundle 把包内 fonts 复制进 dist/excalidraw-assets/fonts（产物 ~13MB，
 *   woff2 按 unicode-range 分片、浏览器按需拉取，不进主 bundle）
 * - dev：middleware 把同前缀请求直接 serve 包内目录，无需复制
 * 运行时入口（main.tsx）设置 window.EXCALIDRAW_ASSET_PATH 指向该前缀。
 */
const excalidrawAssetsPlugin = (): PluginOption => ({
    name: 'mobi-excalidraw-assets',
    configureServer(server) {
        // 不用 connect 的 path 前缀参数（其 strip 行为随版本有差），自判前缀最稳
        server.middlewares.use((req, res, next) => {
            const url = (req.url ?? '').split('?')[0]!
            if (!url.startsWith(EXCALIDRAW_ASSETS_PREFIX)) return next()
            const rel = url.slice(EXCALIDRAW_ASSETS_PREFIX.length)
            const file = resolve(EXCALIDRAW_ASSETS_ROOT, rel)
            if (!file.startsWith(EXCALIDRAW_ASSETS_ROOT) || !existsSync(file) || !statSync(file).isFile()) return next()
            res.setHeader('Content-Type', rel.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream')
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
            res.end(readFileSync(file))
        })
    },
    closeBundle() {
        cpSync(resolve(EXCALIDRAW_ASSETS_ROOT, 'fonts'), resolve(__dirname, 'dist/excalidraw-assets/fonts'), { recursive: true })
    },
})

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        // 画板字体自托管（spec 05）：离线/内网无 CDN
        excalidrawAssetsPlugin(),
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
                // 画板字体（~13MB，unicode-range 分片按需加载）不进预缓存：安装下载量失控，
                // 运行时复用浏览器 HTTP 缓存即可
                globIgnores: ['excalidraw-assets/**'],
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
        // bundle 体积分析（按需）：MOBI_BUNDLE_ANALYZE=1 bun run build
        ...(enableBundleAnalyze
            ? [
                  visualizer({
                      filename: 'dist/stats.html',
                      template: 'treemap',
                      gzipSize: true,
                      brotliSize: true,
                  }),
              ]
            : []),
    ] as PluginOption[],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    },
    // terminal 在 dev 下直连 Hub，绕过 Vite 8 + Bun 无法可靠转发的 WebSocket tunnel；
    // production 构建时该值为 undefined，客户端继续使用同源 origin。
    define: {
        __MOBI_HUB_URL__: JSON.stringify(process.env.NODE_ENV === 'production' ? undefined : hubUrl),
        __MOBI_VERSION__: JSON.stringify(mobiVersion),
    },
    server: {
        host: true,
        port: webPort,
        // mkcert 插件在启用时自动填充 server.https 的 cert/key
        ...(useHttpsDev ? { https: true } : {}),
        proxy: {
            '/api': hubUrl,
            '/manifest.webmanifest': hubUrl,
        }
    }
})
