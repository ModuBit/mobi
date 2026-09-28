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
 * 文件类型徽章接入契约（FileTypeBadge）：
 * - ActionLink：仅 file/open 动作前置徽章（TS 色块 / 目录 glyph），其余动作不画
 * - FileChip：仅带 file/open URI 的可点击 chip 画徽章，纯展示 chip（Bash 命令）不画
 * 判定逻辑已在 fileTypeMeta.test.ts 覆盖，此处只锁「哪些入口画/不画」。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { message } from 'antd'

// ============ mock（hook/函数均返回稳定引用，避免 effect 死循环——工作区已知坑） ============

const navigateSpy = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateSpy,
    useParams: () => ({ sessionId: 'sess-1' }),
}))

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

// antd message 静态 API spy（不整包 mock，theme 等走真实实现）
const messageInfoSpy = vi.spyOn(message, 'info').mockImplementation(() => undefined as never)

beforeEach(() => {
    navigateSpy.mockClear()
    messageInfoSpy.mockClear()
})

afterEach(cleanup)

import { ActionLink } from '@/components/ui/ActionLink'
import { FileChip } from '@/components/ui/FileChip'
import { FileTypeBadge } from '@/components/ui/FileTypeBadge'

describe('ActionLink 文件类型徽章', () => {
    it('file/open：前置扩展名徽章（aria-hidden，不在 accessible name 内）', () => {
        render(<ActionLink uri="mobi://file/open?path=src%2FApp.tsx">App.tsx</ActionLink>)
        const link = screen.getByRole('link', { name: 'App.tsx' })
        // 常用扩展名（ts）画 lucide 类型图标而非文本缩写
        expect(link.querySelector('svg')).toBeInTheDocument()
        expect(link).not.toHaveTextContent('TSX')
    })

    it('file/open 目录路径：画 glyph 徽章（svg）而非文字缩写', () => {
        render(<ActionLink uri="mobi://file/open?path=src%2Fcomponents">components</ActionLink>)
        expect(screen.getByRole('link').querySelector('svg')).toBeInTheDocument()
        expect(screen.getByRole('link')).not.toHaveTextContent('TS')
    })

    it('session/open：不画徽章（非文件语义）', () => {
        render(<ActionLink uri="mobi://session/open?id=s1">s1</ActionLink>)
        const link = screen.getByRole('link')
        expect(link.querySelector('svg')).not.toBeInTheDocument()
        expect(link).toHaveTextContent('s1')
    })
})

describe('FileChip 文件类型徽章', () => {
    it('file/open URI chip：前置徽章 + 路径文本', () => {
        const { container } = render(<FileChip chip={{ text: 'src/index.ts', uri: 'mobi://file/open?path=src%2Findex.ts' }} />)
        // ts 走 lucide 类型图标模式（svg），不再输出文本缩写
        expect(container.querySelector('svg')).toBeInTheDocument()
        expect(screen.getByText('src/index.ts')).toBeInTheDocument()
    })

    it('纯展示 chip（无 URI，Bash 命令）：不画徽章', () => {
        render(<FileChip chip={{ text: 'bun run test' }} />)
        expect(screen.queryByText('TS')).not.toBeInTheDocument()
        expect(screen.getByText('bun run test')).toBeInTheDocument()
    })
})

describe('FileTypeBadge knownFile（fs 事实覆盖启发式误判）', () => {
    it('无扩展名文件：缺省按启发式画目录琥珀色块', () => {
        const { container } = render(<FileTypeBadge path="Caddyfile" />)
        const box = container.firstElementChild as HTMLElement
        expect(box.style.background).toContain('rgba(232, 163, 61, 0.15)')  // #E8A33D + 26 (jsdom 归一化为 rgba)
    })

    it('knownFile：同一路径按无扩展名文件呈现（中性底，不画目录色块）', () => {
        const { container } = render(<FileTypeBadge path="Caddyfile" knownFile />)
        const box = container.firstElementChild as HTMLElement
        expect(box.style.background).toContain('rgba(122, 122, 122, 0.15)')  // #7A7A7A + 26
        expect(box.style.background).not.toContain('232, 163, 61')
    })
})
