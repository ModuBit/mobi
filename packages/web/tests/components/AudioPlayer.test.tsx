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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, fireEvent } from '@testing-library/react'
import AudioPlayer from '@/components/files/AudioPlayer'

// jsdom 的 HTMLAudioElement.play/pause 无实现，mock 并 dispatch 对应事件
beforeEach(() => {
    vi.spyOn(HTMLAudioElement.prototype, 'play').mockImplementation(function (this: HTMLAudioElement) {
        this.dispatchEvent(new Event('play'))
        return Promise.resolve()
    })
    vi.spyOn(HTMLAudioElement.prototype, 'pause').mockImplementation(function (this: HTMLAudioElement) {
        this.dispatchEvent(new Event('pause'))
    })
})

/** 元数据加载：jsdom 不派发 loadedmetadata，手动触发（duration NaN → 组件兜底 0）解锁 loading 门 */
function loadMeta(container: HTMLElement) {
    fireEvent(container.querySelector('audio')!, new Event('loadedmetadata'))
}

describe('AudioPlayer', () => {
    it('渲染：隐藏 audio + 播放按钮（play）+ 文件名 basename + 波形条', () => {
        const { container, getByText } = render(<AudioPlayer src="/x.mp3" filePath="a/b/c.mp3" />)
        expect(container.querySelector('audio')).toBeInTheDocument()
        expect(container.querySelector('button[aria-label="play"]')).toBeInTheDocument()
        expect(getByText('c.mp3')).toBeInTheDocument()
        // 波形：40 根振幅条 × 双层（未播底 + 进度 clip）
        expect(container.querySelectorAll('span.voice-note-bars-bg')).toHaveLength(40)
        expect(container.querySelectorAll('span.voice-note-bars-fg')).toHaveLength(40)
    })

    it('同一文件波形稳定（seed = filePath hash）', () => {
        const bars = (filePath: string) => {
            const { container, unmount } = render(<AudioPlayer src="/x.mp3" filePath={filePath} />)
            const styles = [...container.querySelectorAll('span.voice-note-bars-bg')].map((n) => n.getAttribute('style'))
            unmount()
            return styles
        }
        expect(bars('a/b/c.mp3')).toEqual(bars('a/b/c.mp3'))
        expect(bars('a/b/c.mp3')).not.toEqual(bars('other.mp3'))
    })

    it('点击播放按钮 → 调用 audio.play()，按钮切到 pause', () => {
        const playSpy = vi.spyOn(HTMLAudioElement.prototype, 'play').mockImplementation(function (this: HTMLAudioElement) {
            this.dispatchEvent(new Event('play'))
            return Promise.resolve()
        })
        const { container } = render(<AudioPlayer src="/x.mp3" filePath="a.mp3" />)
        loadMeta(container)
        const btn = container.querySelector('button[aria-label="play"]')!
        fireEvent.click(btn)
        expect(playSpy).toHaveBeenCalled()
        // play 事件触发后 isPlaying=true，按钮 aria-label 切到 pause
        expect(container.querySelector('button[aria-label="pause"]')).toBeInTheDocument()
    })

    it('audio 加载失败 → 触发 onError 回调', () => {
        const onError = vi.fn()
        const { container } = render(<AudioPlayer src="/x.mp3" filePath="a.mp3" onError={onError} />)
        const audio = container.querySelector('audio')!
        // 原生 <audio> 加载失败时浏览器派发 'error' 事件（不经 axios interceptor）
        audio.dispatchEvent(new Event('error'))
        expect(onError).toHaveBeenCalledTimes(1)
    })

    it('play() reject 时不再产生 unhandled rejection（catch 兜底）', async () => {
        vi.spyOn(HTMLAudioElement.prototype, 'play').mockImplementation(() => Promise.reject(new Error('not allowed')))
        const onUnhandled = vi.fn()
        const onUnhandledRejection = (e: PromiseRejectionEvent) => { e.preventDefault(); onUnhandled() }
        window.addEventListener('unhandledrejection', onUnhandledRejection)
        try {
            const { container } = render(<AudioPlayer src="/x.mp3" filePath="a.mp3" />)
            loadMeta(container)
            const btn = container.querySelector('button[aria-label="play"]')!
            fireEvent.click(btn)
            // 等微任务跑完，让 rejected promise 走完 catch
            await new Promise((r) => setTimeout(r, 0))
            expect(onUnhandled).not.toHaveBeenCalled()
        } finally {
            window.removeEventListener('unhandledrejection', onUnhandledRejection)
        }
    })

    it('播放中 onPlayingChange 上报 true/false（useFileMediaSrc 播放锁契约）', () => {
        const onPlayingChange = vi.fn()
        const { container } = render(<AudioPlayer src="/x.mp3" filePath="a.mp3" onPlayingChange={onPlayingChange} />)
        loadMeta(container)
        fireEvent.click(container.querySelector('button[aria-label="play"]')!)
        expect(onPlayingChange).toHaveBeenLastCalledWith(true)
        fireEvent.click(container.querySelector('button[aria-label="pause"]')!)
        expect(onPlayingChange).toHaveBeenLastCalledWith(false)
    })

    it('时间标签点击循环倍速 1→1.5→2→1，非 1 倍速显示徽章', () => {
        const { container, getByText } = render(<AudioPlayer src="/x.mp3" filePath="a.mp3" />)
        loadMeta(container)
        const time = container.querySelector('.voice-note-time')!
        fireEvent.click(time)
        expect(container.querySelector('.voice-note-speed')).toHaveTextContent('1.5×')
        fireEvent.click(time)
        expect(getByText('2×')).toBeInTheDocument()
        fireEvent.click(time)
        expect(container.querySelector('.voice-note-speed')).not.toBeInTheDocument()
    })
})
