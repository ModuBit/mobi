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

import { isAbsolute } from 'node:path';

/**
 * 获取调用时的当前工作目录
 * 优先使用 MOBI_INVOKED_CWD 环境变量（用于 runner-spawned sessions）
 */
export function getInvokedCwd(): string {
    const invokedCwd = process.env.MOBI_INVOKED_CWD?.trim();
    if (invokedCwd && isAbsolute(invokedCwd)) {
        return invokedCwd;
    }
    return process.cwd();
}
