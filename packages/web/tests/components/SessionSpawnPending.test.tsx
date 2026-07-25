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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import { SessionSpawnPending } from '@/components/session/SessionSpawnPending'

// mock i18next：提供固定文案映射
// initReactI18next 必须 noop 导出 —— AnimateLogo → uiStore 链触发 i18n/index.ts 顶层
// 的 i18n.use(initReactI18next).init()，缺这个导出会在模块加载期抛错
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'newSession.spawnStage.creating': '正在创建会话…',
                'newSession.spawnStage.creatingSub': '已发送请求，等待响应…',
            }
            return map[key] ?? key
        },
    }),
}))

const wrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

describe('SessionSpawnPending', () => {
    // vitest 未开 globals，@testing-library/react 的 auto-cleanup 不会自动注册，
    // 需显式 cleanup，否则多次 render 的 DOM 累积导致 getBy\* 找到多元素
    afterEach(cleanup)

    it('渲染机器名与目录回显', () => {
        render(<SessionSpawnPending machineLabel="mbp-pro" directory="~/workspace/mobi" />, { wrapper })
        expect(screen.getByText('mbp-pro')).toBeInTheDocument()
        expect(screen.getByText('~/workspace/mobi')).toBeInTheDocument()
    })

    it('directory 为空时回显 /', () => {
        render(<SessionSpawnPending machineLabel="mbp" directory="" />, { wrapper })
        expect(screen.getByText('/')).toBeInTheDocument()
    })

    it('显示固定创建文案（不切换、不计时）', () => {
        render(<SessionSpawnPending machineLabel="mbp" directory="~/mobi" />, { wrapper })
        expect(screen.getByText('正在创建会话…')).toBeInTheDocument()
        expect(screen.getByText('已发送请求，等待响应…')).toBeInTheDocument()
    })

    it('文案容器具备 role=status 可访问性', () => {
        render(<SessionSpawnPending machineLabel="mbp" directory="~/mobi" />, { wrapper })
        const status = screen.getByRole('status')
        expect(status).toHaveTextContent('正在创建会话')
        expect(status).toHaveAttribute('aria-live', 'polite')
    })
})
