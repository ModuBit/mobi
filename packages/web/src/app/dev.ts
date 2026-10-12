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
 * Web Dev Server 入口脚本
 *
 * 支持 --profile <name> 参数加载环境变量后启动 Vite dev server。
 * 用法：bun run dev --profile dev
 */

import { loadProfile } from '@mobi/shared/profile'

// 从 process.argv 解析参数（dev.ts 是直接被 bun 执行的）
const args = process.argv.slice(2)

// 加载 profile（注入环境变量）
const profile = loadProfile(args)

if (profile) {
    console.log(`[PROFILE] 已加载 profile: ${profile}`)
    console.log(`[PROFILE] MOBI_API_URL=${process.env.MOBI_API_URL || 'http://localhost:2222'}`)
    console.log(`[PROFILE] MOBI_WEB_PORT=${process.env.MOBI_WEB_PORT || '5173'}`)
}

// 环境变量已就绪，启动 Vite
// Vite 会自动读取 vite.config.ts（此时 process.env 中的值已生效）
import('vite').then(async ({ createServer }) => {
    const server = await createServer()
    await server.listen()
    server.printUrls()
}).catch((err) => {
    console.error('启动 Vite dev server 失败:', err)
    process.exit(1)
})
