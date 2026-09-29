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
 * 原子文件写（tmp + rename）：防半截 JSON——事实源落盘的统一纪律
 * （tool-changes.json / turn-archive.json 共用， readers 读到坏文件按空起步的
 * 容错是最后防线，不是这道纪律的替代品）。
 */

import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeFileAtomic(filePath: string, data: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${process.pid}.tmp`
    await writeFile(tmp, data)
    await rename(tmp, filePath)
}
