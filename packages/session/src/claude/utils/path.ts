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
 * 工作目录 → Claude Code 项目目录。
 *
 * 实现已下沉 node-core（`claudeSdk/transcriptPath`）——daemon 删除 transcript 与
 * session 侧读写必须共用同一份编码规则，这里只保留既有导入路径的转发。
 */
export { getClaudeProjectPath as getProjectPath } from '@mobi/node-core/claudeSdk/transcriptPath'
