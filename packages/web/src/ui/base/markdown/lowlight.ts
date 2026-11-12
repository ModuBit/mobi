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

import { common, createLowlight } from 'lowlight'

/**
 * 代码高亮语言注册表单例（common 常用语言；配色复用全局 styles/highlight.css 的
 * hljs 双档主题）。composer 与文件编辑器共用同一实例——createLowlight 内部是
 * 独立的 highlight.js 注册表，各建一份会重复注册全部语法并可能随演进分叉。
 */
export const lowlight = createLowlight(common)
