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
import '@testing-library/jest-dom/vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import MediaContentView from '@/components/files/MediaContentView'

/** 从 media.src 取回 query 参数（不耦合具体编码方式） */
function srcQuery(el: HTMLMediaElement) {
    return new URL(el.src, 'http://localhost').searchParams
}

describe('MediaContentView', () => {
    afterEach(() => cleanup())

    it('video：渲染 <video>，src 直连 read-file 端点', () => {
        const { container } = render(<MediaContentView sessionId="s1" filePath="a/b.mp4" isAudio={false} etag="e1" />)
        const video = container.querySelector('video')!
        expect(video).toBeInTheDocument()
        expect(video.src).toContain('/api/sessions/s1/read-file')
        expect(srcQuery(video).get('path')).toBe('a/b.mp4')
    })

    it('audio：渲染 <audio>', () => {
        const { container } = render(<MediaContentView sessionId="s1" filePath="a.mp3" isAudio etag="e1" />)
        expect(container.querySelector('audio')).toBeInTheDocument()
        expect(container.querySelector('video')).not.toBeInTheDocument()
    })

    it('未播放时 etag 变化 → src 立即跟着换（感知内容变化）', () => {
        const { container, rerender } = render(
            <MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v1" />,
        )
        expect(srcQuery(container.querySelector('video')!).get('v')).toBe('v1')

        rerender(<MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v2" />)
        expect(srcQuery(container.querySelector('video')!).get('v')).toBe('v2')
    })

    it('播放中 etag 变化 → src 不动（换 src 会重新加载、进度归零）', () => {
        const { container, rerender } = render(
            <MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v1" />,
        )
        const video = container.querySelector('video')!
        fireEvent.play(video)

        rerender(<MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v2" />)
        expect(srcQuery(container.querySelector('video')!).get('v')).toBe('v1')
    })

    it('播放中变化的 etag 在暂停后补上（延后而非丢弃）', () => {
        const { container, rerender } = render(
            <MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v1" />,
        )
        fireEvent.play(container.querySelector('video')!)
        rerender(<MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v2" />)
        expect(srcQuery(container.querySelector('video')!).get('v')).toBe('v1')

        // 暂停 → 补上播放期间积压的新版本
        fireEvent.pause(container.querySelector('video')!)
        expect(srcQuery(container.querySelector('video')!).get('v')).toBe('v2')
    })

    it('播放结束同样解除锁定（ended 也复位播放态）', () => {
        const { container, rerender } = render(
            <MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v1" />,
        )
        fireEvent.play(container.querySelector('video')!)
        rerender(<MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v2" />)
        fireEvent.ended(container.querySelector('video')!)
        expect(srcQuery(container.querySelector('video')!).get('v')).toBe('v2')
    })

    it('音频播放中同样锁定 src（经 AudioPlayer 的 onPlayingChange 上报）', () => {
        const { container, rerender } = render(
            <MediaContentView sessionId="s1" filePath="a.mp3" isAudio etag="v1" />,
        )
        fireEvent.play(container.querySelector('audio')!)

        rerender(<MediaContentView sessionId="s1" filePath="a.mp3" isAudio etag="v2" />)
        expect(srcQuery(container.querySelector('audio')!).get('v')).toBe('v1')

        fireEvent.pause(container.querySelector('audio')!)
        expect(srcQuery(container.querySelector('audio')!).get('v')).toBe('v2')
    })

    // 播放中出错会卸载 <video>，而卸载 DOM 节点浏览器不补发 pause 事件。
    // 若 onError 不显式复位播放态，latch 会永久冻结在出错那一刻的 etag，
    // 后续所有内容变化（含用户手点「刷新」）全部丢弃。
    it('播放中出错 → 重试后仍能采纳新 etag（播放态不卡死）', () => {
        const { container, getByRole, rerender } = render(
            <MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v1" />,
        )
        fireEvent.play(container.querySelector('video')!)
        fireEvent.error(container.querySelector('video')!)
        // 元素已被失败态替换
        expect(container.querySelector('video')).not.toBeInTheDocument()

        fireEvent.click(getByRole('button', { name: 'files.retry' }))
        rerender(<MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v2" />)
        expect(srcQuery(container.querySelector('video')!).get('v')).toBe('v2')
    })

    it('出错后 etag 变化自动清除失败态（内容修好了不必手点重试）', () => {
        const { container, rerender } = render(
            <MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v1" />,
        )
        fireEvent.error(container.querySelector('video')!)
        expect(container.querySelector('video')).not.toBeInTheDocument()

        rerender(<MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v2" />)
        expect(srcQuery(container.querySelector('video')!).get('v')).toBe('v2')
    })

    // 同一 tab 内换文件时组件实例被复用（tab.id 不变，见 openFileInTab），
    // 播放态/失败态/etag 都属于上一个文件，必须整体作废
    it('换文件 → 立即用新文件的 etag，且不继承上一个文件的播放锁定', () => {
        const { container, rerender } = render(
            <MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v1" />,
        )
        fireEvent.play(container.querySelector('video')!)

        rerender(<MediaContentView sessionId="s1" filePath="b.mp4" isAudio={false} etag="v9" />)
        const q = srcQuery(container.querySelector('video')!)
        expect(q.get('path')).toBe('b.mp4')
        // 旧文件的 etag 不得泄漏到新文件的第一帧 src
        expect(q.get('v')).toBe('v9')
    })

    it('换文件 → 清掉上一个文件的失败态（不显示继承来的重试界面）', () => {
        const { container, rerender } = render(
            <MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="v1" />,
        )
        fireEvent.error(container.querySelector('video')!)
        expect(container.querySelector('video')).not.toBeInTheDocument()

        rerender(<MediaContentView sessionId="s1" filePath="b.mp4" isAudio={false} etag="v1" />)
        expect(srcQuery(container.querySelector('video')!).get('path')).toBe('b.mp4')
    })

    it('容器带 media-content-view 类（承载尺寸约束 / y 方向居中）', () => {
        const { container } = render(<MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} etag="e1" />)
        expect(container.querySelector('.media-content-view')).toBeInTheDocument()
    })
})
