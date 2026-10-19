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
 * openui 自定义函数目录（票 02，59 个）——单一来源，两个消费端：
 * - web 渲染器（mobiLibrary）：注册进 react-lang 库，函数在用户浏览器本地求值
 * - session prompt 生成器：随 library.prompt()/generateSystemPrompt 进入
 *   核心段与 openui skill，模型据此知道可调用哪些函数
 *
 * 放置理由：两包（web / session）互不可依赖，shared 是唯一共同依赖；函数本身
 * 是纯 JS + Zod schema，不触 React、不触 Node，属跨端共享的生成端协议。
 *
 * 来源：https://github.com/thesysdev/open-intelligent-ui `src/lib/functions/`
 * （list 19 / numbers 9 / text 12 / colors 1 / dates 8 / data 10 = 59）。
 * 上游为 MIT 许可，以下声明随代码保留：
 *
 * MIT License
 *
 * Copyright (c) Thesys Dev
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * 与上游的差异：仅类型收窄（strict TS 下裸 `Record` / `Map` 补泛型）、注释
 * 中文化；函数行为、参数顺序与描述文本保持逐字一致（描述文本会进入 prompt，
 * 改动即改变模型可见的文档）。
 */

import { colorFunctions } from './colors'
import { dataFunctions } from './data'
import { dateFunctions } from './dates'
import { listFunctions } from './lists'
import { numberFunctions } from './numbers'
import { textFunctions } from './text'

export { colorFunctions } from './colors'
export { dataFunctions } from './data'
export { dateFunctions, isoDay, parseDate } from './dates'
export { listFunctions } from './lists'
export { numberFunctions } from './numbers'
export { textFunctions } from './text'
export { MAX_ITEMS } from './shared'

/**
 * 全量函数目录（59 个，按上游分类顺序）——模型以 `@Name(args)` 调用，
 * 求值发生在浏览器；参数不合法或执行抛错时该调用求值为 null。
 */
export const openuiFunctions = [
    ...listFunctions,
    ...numberFunctions,
    ...textFunctions,
    ...colorFunctions,
    ...dateFunctions,
    ...dataFunctions,
]
