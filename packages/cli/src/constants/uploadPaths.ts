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

import { join } from 'path'
import { tmpdir } from 'os'

export const MOBI_BLOBS_DIR_NAME = 'mobi-blobs'

/**
 * 获取项目根目录下的 attachments 目录路径
 * @param projectRoot 项目根目录
 * @returns .mobi/attachments 目录的绝对路径
 */
export function getAttachmentsDir(projectRoot: string): string {
    return join(projectRoot, '.mobi', 'attachments')
}

/**
 * @deprecated 使用 getAttachmentsDir 代替，新上传路径为项目内 .mobi/attachments/
 */
export function getMobiBlobsDir(): string {
    return join(tmpdir(), MOBI_BLOBS_DIR_NAME)
}
