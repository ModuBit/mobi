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
 * mobi 数据目录与 SQLite 路径的唯一派生来源。
 *
 * daemon 启动（写库）与 CLI 的只读会话查询必须指向同一个库，路径规则只在此处定义：
 * - 数据目录：MOBI_HOME（支持 ~ 展开）> ~/.mobi
 * - 数据库：DB_PATH（支持 ~ 展开）> {数据目录}/mobi.db
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export function resolveMobiDataDir(env: NodeJS.ProcessEnv = process.env): string {
    return env.MOBI_HOME ? env.MOBI_HOME.replace(/^~/, homedir()) : join(homedir(), '.mobi')
}

export function resolveMobiDbPath(env: NodeJS.ProcessEnv = process.env): string {
    return env.DB_PATH ? env.DB_PATH.replace(/^~/, homedir()) : join(resolveMobiDataDir(env), 'mobi.db')
}
