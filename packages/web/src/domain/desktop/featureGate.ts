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
 * 桌面观看 UI 入口闸。
 *
 * 桌面观看/控制权功能本体已实现（迭代 1+2），但真机链路尚不稳定
 * （5K 首帧洪峰带宽、macOS 屏幕共享服务僵死等，见 docs/pending.md #82），
 * 置 false 隐藏全部用户可点击入口；/desktop 直链仍可达，便于恢复验收。
 * 稳定后（迭代 3 tile 带宽方案落地）翻回 true。
 */
export const DESKTOP_ENTRY_ENABLED = false
