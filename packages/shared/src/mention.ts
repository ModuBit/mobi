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
 * @ mention 路径字符集（正则源字符串，含字符类括号）——协议级定义的单源：
 * 决定哪些用户输入成为 mention token（进而生成 file/open URI），输入框补全触发
 * （mentionParser）与消息渲染（mentionPlugin）必须一致，改这里即可。
 *
 * 排除法而非白名单：真实文件名空间太大（中日韩文、emoji、括号 `备份(1).pdf`、
 * `#`/`+`/`@`/`|` 等符号），白名单永远有遗漏；只要排除掉有歧义或结构风险的字符，
 * 其余一律放行，行为是「宽容识别 + 服务端读边界诚实承接不可达」。
 *
 * 排除集及理由：
 * - `\s`（空格/tab/换行）：token 终止符。纯文本流无 delimiter，路径含空格无法
 *   与「mention 后跟正文」区分（GitHub/Slack/Discord 的 @ 同样不支持空格）
 * - `` ` ``：markdown 行内代码结构符，避免与代码 span 嵌套纠缠
 * - `<` `>` `"`：HTML/attribute 结构符（防止吞半个标签 / 进 href 属性）
 * - `\`：markdown 转义符 + Windows 分隔符歧义
 */
export const MENTION_PATH_CHARS = '[^\\s`<"\\\\]'
