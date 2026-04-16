#!/usr/bin/env bun
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

// 必须在所有其他模块 import 之前加载 profile，
// 因为 Configuration 单例在模块加载时就会读取 process.env
import { loadProfile } from '@mobi/shared/profile'

// 加载 profile 并从 process.argv 中移除 --profile 参数
// （loadProfile 会 splice 传入的数组，这里直接传 argv 切片以同步移除）
const argvSlice = process.argv.slice(2)
loadProfile(argvSlice)
// 同步修改 process.argv，确保下游 getCliArgs() 不再看到 --profile
process.argv = [process.argv[0], process.argv[1], ...argvSlice]

// 动态 import，确保 profile 环境变量已注入后再加载依赖模块
import('./commands/runCli').then(({ runCli }) => {
    void runCli()
}).catch((err) => {
    console.error('Failed to start CLI:', err)
    process.exit(1)
})
