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

import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { CHROME_BG } from '@mobi/shared'
import { configuration } from '../../configuration'

/** 截短名称，保留最多 6 个字符 */
function toShortName(name: string): string {
    return name.length > 6 ? name.slice(0, 6) + '..' : name
}

export function createManifestRoutes(): Hono {
    const app = new Hono()

    app.get('/manifest.webmanifest', (c) => {
        const daemonName = configuration.daemonName
        const id = 'mobi-' + createHash('sha256').update(daemonName).digest('hex').slice(0, 8)

        const manifest = {
            id,
            name: `Mobi - ${daemonName}`,
            short_name: `Mobi·${toShortName(daemonName)}`,
            description: 'Claude Code 远程控制工具',
            start_url: '/?from=pwa',
            scope: '/',
            display: 'standalone',
            // WCO：桌面端 PWA 把系统标题栏区域交还 Web 内容（按钮浮在内容上）。
            // 浏览器逐项尝试，window-controls-overlay 不可用时回退 standalone（现状）。
            display_override: ['window-controls-overlay', 'standalone'],
            // 与 web 端 chrome 底色同源：共引 @mobi/shared 的 CHROME_BG（daemon 不依赖 web），
            // 取 light 档——manifest 是静态一份，装入态的启动画面/系统栏按默认主题着色
            theme_color: CHROME_BG.light,
            background_color: CHROME_BG.light,
            icons: [
                {
                    src: '/brand/logo.svg',
                    sizes: 'any',
                    type: 'image/svg+xml',
                    purpose: 'any',
                },
                {
                    src: '/brand/icon.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                },
            ],
        }

        return c.json(manifest, 200, {
            'Content-Type': 'application/manifest+json',
            'Cache-Control': 'no-cache',
        })
    })

    return app
}
