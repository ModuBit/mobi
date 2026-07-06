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

import { describe, it, expect } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import MediaContentView from '@/components/files/MediaContentView'

describe('MediaContentView', () => {
    it('video：渲染 <video>，src 直连 read-file 端点', () => {
        const { container } = render(<MediaContentView sessionId="s1" filePath="a/b.mp4" isAudio={false} />)
        const video = container.querySelector('video')!
        expect(video).toBeInTheDocument()
        expect(video.src).toContain('/api/sessions/s1/read-file')
        expect(video.src).toContain(encodeURIComponent('a/b.mp4'))
    })

    it('audio：渲染 <audio>', () => {
        const { container } = render(<MediaContentView sessionId="s1" filePath="a.mp3" isAudio />)
        expect(container.querySelector('audio')).toBeInTheDocument()
        expect(container.querySelector('video')).not.toBeInTheDocument()
    })

    it('容器带 media-content-view 类（承载尺寸约束 / y 方向居中）', () => {
        const { container } = render(<MediaContentView sessionId="s1" filePath="a.mp4" isAudio={false} />)
        expect(container.querySelector('.media-content-view')).toBeInTheDocument()
    })
})
