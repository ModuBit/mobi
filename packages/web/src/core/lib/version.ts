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
import { readFileSync } from 'fs'

/**
 * 从 cli package.json 读取 mobi 产品版本（与 `mobi --version` 同源）。
 * 构建期（vite define 注入 __MOBI_VERSION__）与测试期（setup stub）共用，
 * 避免两处各自 readFileSync + JSON.parse + 类型断言的重复。
 *
 * @param cliPackageJsonPath cli 包 package.json 的绝对路径（调用方按自身位置 resolve）
 */
export function readMobiVersion(cliPackageJsonPath: string): string {
    return (JSON.parse(readFileSync(cliPackageJsonPath, 'utf-8')) as {
        version: string
    }).version
}
