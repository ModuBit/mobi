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
 * output style 切换的退出哨兵：入队 isolate 队列唤醒阻塞中的 nextMessage 并
 * 触发当前 query 循环退出（机制同 REWIND_EXIT_SENTINEL，见 rewindHandlers.ts）。
 * launcher 的 nextMessage 识别后直接丢弃。与 rewind 哨兵互异以便日志区分来源。
 */
export const OUTPUT_STYLE_EXIT_SENTINEL = '__mobi_output_style_exit__'
