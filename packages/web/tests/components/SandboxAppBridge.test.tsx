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
 * SandboxHtmlFrame bridge 行为（generative-ui 票 06）：来源 frame 校验（event.source
 * 必须是本 frame 的 contentWindow）+ 白名单 schema + 限流，通过后 onIssueNewTurn 回调。
 * 断言外部行为：什么 postMessage 能触发回调——换实现方式仍应成立。
 */

import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { SandboxHtmlFrame } from '@/ui/base/sandbox/SandboxHtmlFrame'
import { injectAppBridgeScript } from '@/ui/base/sandbox/sandboxAppHost'

vi.mock('@/core/data/hooks/queries/useFileTree', () => ({
    useFileMeta: () => ({ data: { etag: 'e1' }, dataUpdatedAt: 1 }),
}))
vi.mock('@/core/data/stores/uiStore', () => ({
    useUiStore: () => 'light',
    resolveTheme: () => 'light' as const,
}))
vi.mock('@/core/utils/fileUrl', () => ({ buildServeFileUrl: () => 'http://localhost/artifact' }))

/** 以指定 source 派发一条 postMessage 到 window */
function postFrom(source: Window | null, data: unknown) {
    window.dispatchEvent(new MessageEvent('message', { data, source }))
}

function renderFrame(onIssueNewTurn?: (text: string) => void) {
    const { container } = render(
        <SandboxHtmlFrame sessionId="s1" path="a.html" title="t" app={onIssueNewTurn ? { onIssueNewTurn } : undefined} />,
    )
    const iframe = container.querySelector('iframe')!
    expect(iframe).not.toBeNull()
    return iframe
}

describe('SandboxHtmlFrame bridge（票 06）', () => {
    it('本 frame 发来的白名单消息 → onIssueNewTurn 收到 trim 后文本', () => {
        const onIssueNewTurn = vi.fn()
        const iframe = renderFrame(onIssueNewTurn)
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: ' 按当前选择继续 ' })
        expect(onIssueNewTurn).toHaveBeenCalledWith('按当前选择继续')
    })

    it('来源 frame 不对（宿主 window 自己 / null）→ 不触发', () => {
        const onIssueNewTurn = vi.fn()
        renderFrame(onIssueNewTurn)
        postFrom(window, { type: 'mobi-app', action: 'issueNewTurn', text: 'x' })
        postFrom(null, { type: 'mobi-app', action: 'issueNewTurn', text: 'x' })
        expect(onIssueNewTurn).not.toHaveBeenCalled()
    })

    it('非白名单 action / 非法 text → 不触发', () => {
        const onIssueNewTurn = vi.fn()
        const iframe = renderFrame(onIssueNewTurn)
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'openLink', text: 'x' })
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: 123 })
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: '   ' })
        expect(onIssueNewTurn).not.toHaveBeenCalled()
    })

    it('限流：连续两条同 frame 消息只放行第一条（jsdom 时钟连续，必然落进限流窗）', () => {
        const onIssueNewTurn = vi.fn()
        const iframe = renderFrame(onIssueNewTurn)
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: 'first' })
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: 'second' })
        expect(onIssueNewTurn).toHaveBeenCalledTimes(1)
        expect(onIssueNewTurn).toHaveBeenCalledWith('first')
    })

    it('回调随渲染更新经 ref 生效（不因闭包陈旧）', () => {
        const first = vi.fn()
        const second = vi.fn()
        const { container, rerender } = render(
            <SandboxHtmlFrame sessionId="s1" path="a.html" title="t" app={{ onIssueNewTurn: first }} />,
        )
        rerender(<SandboxHtmlFrame sessionId="s1" path="a.html" title="t" app={{ onIssueNewTurn: second }} />)
        const iframe = container.querySelector('iframe')!
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: 'x' })
        expect(second).toHaveBeenCalled()
        expect(first).not.toHaveBeenCalled()
    })
})

describe('SandboxHtmlFrame viz 档高度自适应（visualize-runtime 票 03）', () => {
    it('viz 档：本 frame 的合法高度消息 → iframe 高度取 ceil 后平滑应用', () => {
        const { container } = render(
            <SandboxHtmlFrame sessionId="s1" path="a.html" title="t" viz style={{ height: 480 }} />,
        )
        const iframe = container.querySelector('iframe')!
        postFrom(iframe.contentWindow, { type: 'mobi-viz-height', height: 731.4 })
        expect(iframe.style.height).toBe('732px')
        expect(iframe.style.transition).toContain('height')
    })

    it('viz 档：越界高度（0/负/超 10000）与非本 frame 来源 → 不动高度', () => {
        const { container } = render(
            <SandboxHtmlFrame sessionId="s1" path="a.html" title="t" viz style={{ height: 480 }} />,
        )
        const iframe = container.querySelector('iframe')!
        postFrom(iframe.contentWindow, { type: 'mobi-viz-height', height: 0 })
        postFrom(iframe.contentWindow, { type: 'mobi-viz-height', height: 20000 })
        postFrom(iframe.contentWindow, { type: 'mobi-viz-height', height: 'tall' })
        postFrom(window, { type: 'mobi-viz-height', height: 900 })
        expect(iframe.style.height).toBe('480px')
    })

    it('非 viz 档（app/普通预览）收到高度消息 → 高度不变（自适应仅 viz 生效）', () => {
        const { container } = render(
            <SandboxHtmlFrame sessionId="s1" path="a.html" title="t" style={{ height: 480 }} />,
        )
        const iframe = container.querySelector('iframe')!
        postFrom(iframe.contentWindow, { type: 'mobi-viz-height', height: 900 })
        expect(iframe.style.height).toBe('480px')
    })
})

describe('injectAppBridgeScript 合并语义（票 03：viz 档 daemon 桥先建 MobiApp 不丢回灌）', () => {
    /** 注入脚本不自动执行（jsdom），直接以受控 window/parent 求值脚本文本 */
    const runInjected = (doc: Document, fakeWindow: Record<string, unknown>) => {
        const text = doc.getElementById('mobi-app-bridge')?.textContent ?? ''
        expect(text).not.toBe('')
        // eslint-disable-next-line no-new-func -- 被测物本身是生成的 IIFE 文本
        new Function('window', 'parent', 'location', text)(
            fakeWindow,
            { postMessage: vi.fn() },
            { origin: 'http://localhost' },
        )
        return fakeWindow.MobiApp as Record<string, unknown>
    }

    it('已有 MobiApp（viz 组装桥）→ 只补 issueNewTurn，保留既有成员', () => {
        const doc = document.createElement('div').ownerDocument!
        doc.head.querySelectorAll('#mobi-app-bridge').forEach((n) => n.remove())
        injectAppBridgeScript(doc)
        const api = runInjected(doc, { MobiApp: { setWidgetState: () => {} } })
        expect(typeof api.issueNewTurn).toBe('function')
        expect(typeof api.setWidgetState).toBe('function')
    })

    it('无 MobiApp → 建立并挂 issueNewTurn；重复注入只落一个 script 节点', () => {
        const doc = document.createElement('div').ownerDocument!
        doc.head.querySelectorAll('#mobi-app-bridge').forEach((n) => n.remove())
        injectAppBridgeScript(doc)
        injectAppBridgeScript(doc)
        expect(doc.querySelectorAll('#mobi-app-bridge').length).toBe(1)
        const api = runInjected(doc, {})
        expect(typeof api.issueNewTurn).toBe('function')
    })
})
