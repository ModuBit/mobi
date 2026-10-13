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
 * 移动 sheet 标记 class：`src/styles/antd.css` 里「高度自适应 + 85dvh 上限 + body
 * safe-area」全局规则只命中此类的 bottom drawer——避免误伤同样 placement=bottom 的非
 * sheet 抽屉（如 PC 画板停靠抽屉的固定高度会被 `height: auto !important` 压塌）。
 *
 * 只有**原生 antd Drawer** 需要挂它（MobileDrawer 退场后，BottomSheet 不再经 antd，
 * 自带高度/安全区不变量）。导出单源：调用方引用常量而非裸字符串，防拼写漂移。
 */
export const MOBILE_SHEET_DRAWER_CLASS = 'mobile-sheet-drawer'
