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
 * mermaid 预览 widget 的 DOM 构建器（raw DOM，非 React）。
 *
 * 为何不用 React：widget 由 ProseMirror decoration 管理，创建/移除时机由 decoration diff 决定，
 * 没有可靠的 destroy 回调；React root 挂进去会泄漏。raw DOM + 闭包 + 监听器随 widget DOM 被 GC。
 *
 * 缩放 + 平移都用 CSS transform（translate + scale）在 inner 上：
 * ⚠️ 不能用 overflow/scroll 平移——transform: scale 不改变布局尺寸，scrollLeft/Top 恒为 0，拖不动。
 *
 * touch-action 动态：zoom<=1 用 pan-y（浏览器原生纵向滚动查看超高图）；zoom>1 用 none
 * （完全自管 pinch+平移）。pinch 不会因 pan-y 丢失——两指手势浏览器不消费，仍派发给 JS。
 *
 * viewCache 按块级稳定键（pos）：编辑某块源码时 code 每键变但 pos 不变，缩放/平移跨源码编辑保留。
 */
import { renderMermaidInto } from './mermaidRender'

const clampZoom = (z: number) => Math.min(2, Math.max(0.25, +z.toFixed(2)))

/** lucide 风 stroke 图标（24 viewBox，currentColor，与项目其余图标一致） */
const icon = (paths: string): string =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const ICON = {
    // 复位 100%（四角向外 = 展开铺满）
    reset: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    zoomOut: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',
    zoomIn: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
}

interface ViewState { zoom: number; panX: number; panY: number }
// 块级稳定键（pos）→ 视图状态。跨源码编辑保留缩放/平移（pos 不随 code 变）。上限 50 简单 LRU。
const VIEW_CACHE_CAP = 50
const viewCache = new Map<string, ViewState>()
function setView(key: string, st: ViewState) {
    viewCache.set(key, st)
    if (viewCache.size > VIEW_CACHE_CAP) viewCache.delete(viewCache.keys().next().value!)
}

/** 测试用：清空视图状态缓存 */
export function resetMermaidZoomCache(): void {
    viewCache.clear()
}

/**
 * 创建 mermaid 预览 widget DOM。
 * @param blockKey 块级稳定标识（pos），viewCache 按它保留缩放/平移，跨源码编辑不丢。
 */
export function buildMermaidWidget(code: string, collapsed: boolean, onToggleCollapsed: () => void, blockKey: string): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'mermaid-preview-widget'
    wrap.setAttribute('contenteditable', 'false')

    const viewport = document.createElement('div')
    viewport.className = 'mermaid-viewport'
    const inner = document.createElement('div')
    inner.className = 'mermaid-zoom-inner'
    inner.style.transformOrigin = 'top left'
    viewport.appendChild(inner)
    wrap.appendChild(viewport)

    renderMermaidInto(code, inner)

    // —— 视图状态（缩放 + 平移），按 blockKey 缓存 ——
    const initial = viewCache.get(blockKey) ?? { zoom: 1, panX: 0, panY: 0 }
    let { zoom, panX, panY } = initial
    const apply = () => { inner.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})` }
    const persist = () => setView(blockKey, { zoom, panX, panY })
    const setZoom = (z: number) => { zoom = clampZoom(z); apply(); persist(); syncControls() }

    let dragging = false
    let lastX = 0
    let lastY = 0
    const panBy = (dx: number, dy: number) => {
        if (zoom <= 1) return // 图不溢出时不平移（避免拖飞）
        panX += dx; panY += dy
        apply(); persist()
    }

    // —— 控件按钮 ——
    const mkBtn = (title: string, iconHtml: string, onClick: () => void, extraClass = '') => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = `mermaid-btn ${extraClass}`.trim()
        b.title = title
        b.innerHTML = iconHtml
        b.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
        return b
    }
    const btnReset = mkBtn('复位 100%', icon(ICON.reset), () => { zoom = 1; panX = 0; panY = 0; apply(); persist(); syncControls() })
    const btnOut = mkBtn('缩小', icon(ICON.zoomOut), () => setZoom(zoom - 0.1))
    const btnIn = mkBtn('放大', icon(ICON.zoomIn), () => setZoom(zoom + 0.1))
    let collapsedState = collapsed
    const btnToggle = mkBtn(collapsed ? '展开源码' : '收起源码', icon(collapsed ? ICON.pencil : ICON.eye), () => {
        collapsedState = !collapsedState
        btnToggle.title = collapsedState ? '展开源码' : '收起源码'
        btnToggle.innerHTML = icon(collapsedState ? ICON.pencil : ICON.eye)
        onToggleCollapsed()
    }, 'is-toggle')

    const syncControls = () => {
        btnReset.style.display = zoom !== 1 ? '' : 'none'
        btnReset.title = `复位 100%（当前 ${Math.round(zoom * 100)}%）`
        viewport.style.cursor = zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default'
        viewport.style.userSelect = zoom > 1 ? 'none' : 'auto'
        // zoom<=1：pan-y 让浏览器原生纵向滚动查看超高图；zoom>1：none 完全自管 pinch+平移
        viewport.style.touchAction = zoom > 1 ? 'none' : 'pan-y'
    }

    apply()
    syncControls()

    // 挂载控件（缩放组 | 分隔线 | 源码切换）
    const controls = document.createElement('div')
    controls.className = 'mermaid-controls'
    const group = document.createElement('div')
    group.className = 'mermaid-btn-group'
    group.appendChild(btnReset)
    group.appendChild(btnOut)
    group.appendChild(btnIn)
    const divider = document.createElement('span')
    divider.className = 'mermaid-divider'
    controls.appendChild(group)
    controls.appendChild(divider)
    controls.appendChild(btnToggle)
    wrap.appendChild(controls)

    // —— 鼠标 pointer 拖动（zoom>1 时）——
    const onPointerDown = (e: PointerEvent) => {
        if (e.pointerType === 'touch' || zoom <= 1) return
        dragging = true; lastX = e.clientX; lastY = e.clientY
        syncControls()
    }
    const onPointerMove = (e: PointerEvent) => {
        if (e.pointerType === 'touch' || !dragging) return
        panBy(e.clientX - lastX, e.clientY - lastY)
        lastX = e.clientX; lastY = e.clientY
    }
    const endPointer = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return
        dragging = false; syncControls()
    }
    viewport.addEventListener('pointerdown', onPointerDown)
    viewport.addEventListener('pointermove', onPointerMove)
    viewport.addEventListener('pointerup', endPointer)
    viewport.addEventListener('pointerleave', endPointer)

    // —— 触摸：双指 pinch（带 focal 锚点）+ 单指拖动 ——
    const touchDist = (t: TouchEvent) => {
        const a = t.touches[0]!, b = t.touches[1]!
        return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
    }
    let pinchDist = 0
    let pinchZoom = 1
    let pinchPanX = 0
    let pinchPanY = 0
    let pinchMidX = 0
    let pinchMidY = 0
    const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 2) {
            const a = e.touches[0]!, b = e.touches[1]!
            const rect = viewport.getBoundingClientRect()
            pinchDist = touchDist(e)
            pinchZoom = zoom
            pinchPanX = panX
            pinchPanY = panY
            pinchMidX = (a.clientX + b.clientX) / 2 - rect.left
            pinchMidY = (a.clientY + b.clientY) / 2 - rect.top
            dragging = false
        } else if (e.touches.length === 1) {
            // zoom<=1 不接管单指：让浏览器原生滚动查看超高图（仅 zoom>1 才平移）
            if (zoom <= 1) return
            dragging = true
            lastX = e.touches[0]!.clientX
            lastY = e.touches[0]!.clientY
        }
    }
    const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 2 && pinchDist > 0) {
            e.preventDefault()
            const newZoom = clampZoom(+(pinchZoom * (touchDist(e) / pinchDist)).toFixed(2))
            panX = pinchMidX - (pinchMidX - pinchPanX) * (newZoom / pinchZoom)
            panY = pinchMidY - (pinchMidY - pinchPanY) * (newZoom / pinchZoom)
            zoom = newZoom
            apply(); persist(); syncControls()
        } else if (e.touches.length === 1 && dragging) {
            e.preventDefault()
            const t = e.touches[0]!
            panBy(t.clientX - lastX, t.clientY - lastY)
            lastX = t.clientX; lastY = t.clientY
        }
    }
    const onTouchEnd = (e: TouchEvent) => {
        if (e.touches.length < 2) pinchDist = 0
        if (e.touches.length === 0) dragging = false
        syncControls()
    }
    viewport.addEventListener('touchstart', onTouchStart)
    viewport.addEventListener('touchmove', onTouchMove, { passive: false })
    viewport.addEventListener('touchend', onTouchEnd)
    viewport.addEventListener('touchcancel', onTouchEnd)

    // Ctrl+滚轮缩放（桌面）
    const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey) return
        e.preventDefault()
        setZoom(zoom + (e.deltaY > 0 ? -0.1 : 0.1))
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })

    return wrap
}
