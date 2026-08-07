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
 * 自动保存 debounce：dirty 变 true 后停顿 3s 触发。
 * 3s 平衡点：减少打字中途停顿的无效保存、收窄与 Claude 并发的冲突窗口；
 * 丢数据风险由手动保存（Ctrl/Cmd+S）+ 关 tab flush 兜底。
 */
export const AUTOSAVE_DEBOUNCE_MS = 3000
