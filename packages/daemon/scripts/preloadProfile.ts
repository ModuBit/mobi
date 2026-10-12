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
 * dev 直跑 daemon 的 profile 预加载器（`bun run dev` 用，不参与生产路径）。
 *
 * 为什么需要它：`--profile dev` 必须在**任何模块求值之前**注入 process.env——
 * Configuration 单例在模块加载时就读取 process.env（node-core/configuration.ts）。
 * daemonEntry 静态 import 了 configuration，所以它自己没机会先加载 profile；
 * 而 CLI（`mobi daemon start-sync`）能在静态 import 之前调用 loadProfile，
 * 是因为它把其余模块全部改成了动态 import。
 *
 * 这里用 bun 的 `--preload` 在入口求值前跑本文件，等价于 CLI 那套效果，
 * 同时保住 `bun --watch run src/daemonEntry.ts` 这张静态 import 图——
 * bun 的 watch 不跟踪运行时动态 import，走 CLI 形态会丢掉 daemon 源码的热重载。
 */

import { loadProfile } from '@mobi/shared/profile'

// 与 cli/index.ts 同一用法：loadProfile 会 splice 传入数组，故传 argv 切片
const argvSlice = process.argv.slice(2)
loadProfile(argvSlice)
process.argv = [process.argv[0], process.argv[1], ...argvSlice]
