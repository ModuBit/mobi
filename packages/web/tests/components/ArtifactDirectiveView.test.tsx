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
 * ArtifactDirectiveView 解析失败降级测试：attrs 无效（弯引号/缺 path）时渲染
 * 异常卡（title + 原文 mono 保留），而不是裸展示指令字面量（2026-09-29 用户反馈）。
 */

import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { ArtifactDirectiveView } from '@/components/ui/ArtifactDirectiveComponents'

// 测试断言按 i18n key（项目惯例：t 直接回 key，见 FileContentView.test）
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

describe('ArtifactDirectiveView 解析失败降级', () => {
    it('path 缺失（弯引号等 attrs 解析失败）→ 异常卡：title/hint + 原文 mono 保留', () => {
        render(<ArtifactDirectiveView>{':mobi-artifact{path=“a.png”}'}</ArtifactDirectiveView>)
        expect(screen.getByText('chat.artifact.invalidTitle')).toBeInTheDocument()
        expect(screen.getByText('chat.artifact.invalidHint')).toBeInTheDocument()
        expect(screen.getByText(':mobi-artifact{path=“a.png”}')).toBeInTheDocument()
    })
})
