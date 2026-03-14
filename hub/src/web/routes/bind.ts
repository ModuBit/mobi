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
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'

// Mobi 不支持 Telegram，bind 路由不可用
export function createBindRoutes(_jwtSecret: Uint8Array, _store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/bind', (c) => {
        return c.json({ error: 'Not supported' }, 501)
    })

    return app
}
