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
 * 共享"外层宽动画 + 内层定宽裁剪"原语的动画时长/缓动。
 * AppSidebar、SplitLayout 等裁剪式布局共用，避免多套实现各自漂移。
 */
export const CLIP_DURATION = '0.3s'
export const CLIP_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'
