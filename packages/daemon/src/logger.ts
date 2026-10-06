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

import { createLogger, type MobiLogger } from '@mobi/shared/logger'
import { resolveMobiLogsDir } from '@mobi/shared/exitLogger'

/**
 * daemon 进程统一 logger。
 * main() 最早初始化；其 ringBuffer 注入 exitLogger，崩溃 dump 可还原崩溃前上下文。
 * 文件：~/.mobi/logs/{ts}-daemon.log（历史文件名 -hub.log，读取侧容错归并）
 */
export const daemonLogger: MobiLogger = createLogger({
    processType: 'daemon',
    logsDir: resolveMobiLogsDir(),
})
