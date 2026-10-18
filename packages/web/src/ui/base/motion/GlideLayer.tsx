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

import styled from '@emotion/styled'
import { GlidingHighlight } from './GlidingHighlight'

/**
 * 列表滑移底色层（hover / 选中通用的视觉件）。
 *
 * 由 GlidingHighlight 弹簧跟随目标行的 top/height；放在列表容器里、行之前，
 * 容器需 `position: relative`，行需处于定位层（或用 z-index 保证盖在层上）。
 * 与行的两种目标（hoverEl / activeEl）配合使用，见 useGlideHighlight。
 */
export const GlideLayer = styled(GlidingHighlight)<{ $background: string; $radius?: string }>`
    position: absolute;
    right: 0;
    left: 0;
    border-radius: ${(p) => p.$radius ?? 'var(--radius-icon)'};
    background: ${(p) => p.$background};
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--mobi-duration-fast) var(--mobi-ease-out);
    &[data-on] {
        opacity: 1;
    }
    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }
`
