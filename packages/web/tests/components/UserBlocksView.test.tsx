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

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { UserBlocksView } from '@/components/chat/userBlocks/UserBlocksView'
import type { UserImageBlock } from '@mobi/shared'

// vitest 未开 globals，渲染型测试需显式 cleanup，否则 DOM 累积串味后续断言
afterEach(cleanup)

/** 服务端 uploads 路径形态的 image block */
function serverImageBlock(): UserImageBlock {
    return {
        type: 'image',
        id: 'img-1',
        filename: 'photo.png',
        size: 12345,
        source: { type: 'url', value: '.mobi/uploads/2026-08/photo.png' },
    }
}

describe('UserBlocksView ImageView', () => {
    it('缩略图固定 80×80、objectFit cover 裁切', () => {
        const { container } = render(
            <UserBlocksView blocks={[serverImageBlock()]} env={{ sessionId: 'sess-1' }} />,
        )
        // antd Image：width/height 落外层容器 div，objectFit 经 styles.image 落 <img>
        const holder = container.querySelector('.ant-image') as HTMLElement
        expect(holder).not.toBeNull()
        expect(holder.style.width).toBe('80px')
        expect(holder.style.height).toBe('80px')
        const img = container.querySelector('img')!
        expect(img.style.objectFit).toBe('cover')
    })

    it('服务端路径经 read-file 端点构造 src', () => {
        const { container } = render(
            <UserBlocksView blocks={[serverImageBlock()]} env={{ sessionId: 'sess-1' }} />,
        )
        const img = container.querySelector('img')
        expect(img!.getAttribute('src')).toContain('/api/sessions/sess-1/read-file')
        expect(img!.getAttribute('src')).toContain(encodeURIComponent('.mobi/uploads/2026-08/photo.png'))
    })

    it('blob:/data:/http(s) 自足 URL 直接使用（乐观回显）', () => {
        const block: UserImageBlock = {
            ...serverImageBlock(),
            source: { type: 'url', value: 'blob:http://localhost/abc' },
        }
        const { container } = render(
            <UserBlocksView blocks={[block]} env={{ sessionId: 'sess-1' }} />,
        )
        expect(container.querySelector('img')!.getAttribute('src')).toBe('blob:http://localhost/abc')
    })

    it('文件名承载于 alt（无障碍）+ AppTooltip hover 提示包裹', () => {
        const { container } = render(
            <UserBlocksView blocks={[serverImageBlock()]} env={{ sessionId: 'sess-1' }} />,
        )
        const img = container.querySelector('img')
        expect(img!.getAttribute('alt')).toBe('photo.png')
    })

    it('加载失败 → 切换兜底图（svg data URI），不再请求原 src', () => {
        // 失败态由组件自管：onError 置 failed 换 src，不依赖 rc-image 内部异步校验
        const { container } = render(
            <UserBlocksView blocks={[serverImageBlock()]} env={{ sessionId: 'sess-1' }} />,
        )
        const img = container.querySelector('img')!
        expect(img.getAttribute('src')).not.toMatch(/^data:/)
        fireEvent.error(img)
        expect(container.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    })

    it('连续多图归并到同一横向容器：flex wrap + 间距，不一张一行', () => {
        const blocks = [
            serverImageBlock(),
            { ...serverImageBlock(), id: 'img-2', filename: 'photo2.png' },
            { ...serverImageBlock(), id: 'img-3', filename: 'photo3.png' },
        ]
        const { container } = render(
            <UserBlocksView blocks={blocks} env={{ sessionId: 'sess-1' }} />,
        )
        // 三张图共享同一个 antd Space 容器（横向 flex、可换行）
        const space = container.querySelector('.ant-space')
        expect(space).not.toBeNull()
        expect((space as HTMLElement).style.flexWrap).toBe('wrap')
        expect(space!.querySelectorAll('.ant-space-item .ant-image')).toHaveLength(3)
    })

    it('非连续多图不被归并：text 打断后各自成段', () => {
        const blocks = [serverImageBlock(), { type: 'text', text: '说明' }, serverImageBlock()]
        const { container } = render(
            <UserBlocksView blocks={blocks} env={{ sessionId: 'sess-1' }} />,
        )
        expect(container.querySelectorAll('.ant-space')).toHaveLength(0)
        expect(container.querySelectorAll('.ant-image')).toHaveLength(2)
    })
})
