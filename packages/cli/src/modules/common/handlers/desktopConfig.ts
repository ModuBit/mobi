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
 * 远程桌面配置 RPC（machine 通道）：VNC 密码的写入与配置状态。
 *
 * 密码真身在 macOS 系统设置里，这里持久化的是与之一致的 cli 侧副本
 * （settings.cli.json），供 desktop 流的 attach 认证使用。hub/web 只中转，
 * 不落盘副本；状态查询只回「是否已配置」，密码本身永不回读。
 */

import { desktopVncPasswordSchema } from '@mobi/shared'
import { updateSettings, readSettings } from '@/persistence'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'

export function registerDesktopConfigHandler(manager: RpcHandlerManager): void {
    manager.registerHandler<unknown, { result: 'success' } | { result: 'error'; reason: string }>(
        'set-desktop-vnc-password',
        async (params) => {
            const parsed = desktopVncPasswordSchema.safeParse(params)
            if (!parsed.success) {
                return { result: 'error', reason: 'VNC 密码须为 1-16 个字符（与 macOS 屏幕共享设置一致）' }
            }
            await updateSettings((current) => ({
                ...current,
                desktop: { ...current.desktop, vncPassword: parsed.data.vncPassword },
            }))
            return { result: 'success' }
        },
    )

    manager.registerHandler<unknown, { result: 'success'; configured: boolean }>(
        'get-desktop-vnc-status',
        async () => {
            const settings = await readSettings()
            return { result: 'success', configured: Boolean(settings.desktop?.vncPassword) }
        },
    )
}
