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
import { configuration } from '../../configuration'

/** 截短名称，保留最多 6 个字符 */
function toShortName(name: string): string {
    return name.length > 6 ? name.slice(0, 6) + '..' : name
}

export function createManifestRoutes(): Hono {
    const app = new Hono()

    app.get('/manifest.webmanifest', (c) => {
        const hubName = configuration.hubName
        const id = 'mobi-' + createHash('sha256').update(hubName).digest('hex').slice(0, 8)

        const manifest = {
            id,
            name: `Mobi - ${hubName}`,
            short_name: `Mobi·${toShortName(hubName)}`,
            description: 'Claude Code 远程控制工具',
            start_url: '/?from=pwa',
            scope: '/',
            display: 'standalone',
            theme_color: '#3d3d3a',
            background_color: '#faf9f5',
            icons: [
                {
                    src: '/logo.svg',
                    sizes: 'any',
                    type: 'image/svg+xml',
                    purpose: 'any',
                },
                {
                    src: '/icon.png',
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
