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
 * 草图取数：「草图引用 → 内嵌 scene 的 PNG Blob」（重编辑的取数 seam）。
 * 气泡与 composer 附件两个重编辑入口共用——此前各写一份 fetch，且都要伪造
 * render 层的 UserImageBlock 形状才能复用 resolveUserImageUrl。
 *
 * 只负责取数与抛错；失败提示（toast）是 UI 语义，留给调用方。
 */

import { resolveUserImageUrl } from '@/core/utils/fileUrl'

/** 草图引用：服务端路径（.mobi/uploads 下，重编辑产物均有 path） */
export interface SketchRef {
    path: string
}

/** 解析上下文：read-file 端点寻址所需（machine 优先，缺 machine 回退 session） */
export interface SketchResolveContext {
    sessionId?: string
    machineId?: string
    cwd?: string
}

/**
 * 取回草图 PNG。ref 无 path（理论上不可达：重编辑入口均以 path 存在为前提）或
 * 端点寻址信息不足 / 响应非 ok 时抛错，错误信息含原因。
 */
export async function loadSketchSource(ref: SketchRef, ctx: SketchResolveContext): Promise<Blob> {
    if (!ref.path) throw new Error('草图引用缺少 path')
    const url = resolveUserImageUrl({ source: { type: 'url', value: ref.path } }, ctx)
    if (!url) throw new Error('无法构造草图取数地址（machine/session 信息缺失）')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`read-file ${res.status}`)
    return res.blob()
}
