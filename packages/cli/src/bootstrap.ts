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

// 在编译后的二进制中禁用 Ink devtools，避免引入可选依赖
process.env.DEV = 'false';

// stdio 孤儿管道防护必须先于一切业务逻辑安装：晚于第一条 warning 就等于没装。
// 详见 utils/stdioEpipeGuard.ts 头注（2026-08-27 会话暴毙事故的根因加固）
const { installStdioEpipeGuard } = await import('./utils/stdioEpipeGuard');
installStdioEpipeGuard();

await import('./index');

export {};
