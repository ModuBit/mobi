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
 * 整页刷新（拉最新 no-cache index.html）。
 *
 * 单独抽成具名导出，便于测试 vi.mock（jsdom 下 window.location.reload 不可重定义、
 * 无法直接 spyOn）。语义上也比裸 window.location.reload() 更自文档化。
 */
export function reloadPage(): void {
    window.location.reload()
}
