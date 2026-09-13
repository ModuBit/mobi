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
 * change_title 的**对外形状单源**：名字、说明、标题、入参 schema。
 *
 * 为什么单独一个模块（只依赖 zod，不碰 logger / config / ApiSessionClient）：三种壳都要
 * 用它，而其中最轻的是 `mobi mcp` 的 stdio bridge——那是一个「只转发不执行」的子进程，
 * 让它为了四个字段去 import 整条工具实现（连带 logger / configuration / persistence）
 * 不划算。此前 bridge 自己抄了一份 description / title / schema，同一工具两个真相源。
 */

import { z } from 'zod'

export const CHANGE_TITLE_TOOL_NAME = 'change_title' as const

export const CHANGE_TITLE_TOOL_SHAPE = {
    name: CHANGE_TITLE_TOOL_NAME,
    description: 'Change the title of the current chat session',
    title: 'Change Chat Title',
    inputSchema: z.object({
        title: z.string().describe('The new title for the chat session'),
    }),
}
