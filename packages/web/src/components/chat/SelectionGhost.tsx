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
 * 选区 ghost 高亮：评论输入期间原生选区必然失守（焦点进输入框即 collapsed），
 * 用捕获时冻结的 getClientRects() 画一组 fixed 色块模拟选中态。纯视觉、pointer-events
 * 穿透（点击文本仍触发调用方的 mousedown-outside 取消）；位置静态不跟随——评论浮层
 * 开启期间滚动即取消（几何失效），与浮层同一生命周期。
 */

/** ghost 色与原生 ::selection 同源（--mobi-selection-bg，见 styles/base.css）：
 *  荧光笔暖染随主题切换，评论期间与「刚才划选」的观感连续 */
const GHOST_BG = 'var(--mobi-selection-bg)'

export function SelectionGhost({ rects }: { rects: DOMRect[] }) {
    return (
        <>
            {rects.map((r, i) => (
                <div
                    key={i}
                    aria-hidden
                    style={{
                        position: 'fixed',
                        top: r.top,
                        left: r.left,
                        width: r.width,
                        height: r.height,
                        background: GHOST_BG,
                        borderRadius: 2,
                        pointerEvents: 'none',
                        zIndex: 1040,
                    }}
                />
            ))}
        </>
    )
}
