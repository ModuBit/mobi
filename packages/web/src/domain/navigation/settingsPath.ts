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
 * 设置路由族判断（/settings 及其子路径）。
 *
 * 消费方横跨多个 feature（layout 布局分支「设置是全屏视图」、layout 返回来源过滤、
 * settings registry 自身的分区解析），域间互引禁止——路由族知识归 domain/navigation 单一来源，
 * settings 分区解析（activeSection）也引用本判断而非自持前缀字面量。
 */
export function isSettingsPath(pathname: string): boolean {
    return pathname === '/settings' || pathname.startsWith('/settings/')
}
