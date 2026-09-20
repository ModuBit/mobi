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
 * read-file 端点 URL 构造。
 *
 * 图片 / 音视频 / PDF 不走 react-query 的 content 通道（见 useFileRenderState 的 needsContent），
 * 而是把 URL 直接交给 `<img src>` / `<video src>` / pdfjs。这带来一个后果：
 * **URL 不变，浏览器就不会重新请求**——文件内容原地改了（路径与文件名不变）也看不到新内容，
 * 因为 React 传下去的 src 字符串一模一样，DOM 元素压根没被通知去重新加载。
 *
 * 所以内容版本必须体现在 URL 里：把 meta 的 etag（cli 侧 = `size-mtimeMs`，内容变则变）
 * 作为 `v` 参数并入。文件变化 → etag 变 → src 变 → 浏览器重新请求。
 * 这与文本类「etag 进 react-query queryKey」是同一思路，只是载体换成 URL。
 *
 * etag 稳定时 URL 也稳定，浏览器与 HTTP 协商缓存照常复用，不会白下载。
 */
import { isSelfContainedUrl, type UserImageBlock } from '@mobi/shared'

export function buildReadFileUrl(
    sessionId: string,
    filePath: string,
    opts: {
        /** 文件内容版本（来自 meta.etag）；省略则不带 v（如尚未拿到 meta） */
        etag?: string
        /** 下载模式：追加 download=1，让 hub 下发 attachment content-disposition */
        download?: boolean
        /**
         * 重试计数：加载失败后手动重试用。
         * 与 etag 分开是有意的——401/cookie 过期时文件本身没变（etag 不变），
         * 只有独立的计数器才能造出新 URL 绕开缓存、触发重新认证。
         */
        retry?: number
    } = {},
): string {
    const params = new URLSearchParams({ path: filePath })
    if (opts.download) params.set('download', '1')
    if (opts.etag) params.set('v', opts.etag)
    if (opts.retry) params.set('_retry', String(opts.retry))
    return `/api/sessions/${sessionId}/read-file?${params.toString()}`
}

/**
 * machine 通道 read-file 端点 URL 构造：跨会话存活的静态资源读取（消息附件预览等）。
 * 与 buildReadFileUrl 的 v 参数机制一致（etag 作内容版本），协商缓存行为相同；
 * 差异仅在寻址——sessionId 换成 machineId + cwd 显式二元组，会话关闭不影响可达性。
 */
export function buildMachineReadFileUrl(
    machineId: string,
    cwd: string,
    filePath: string,
    opts: {
        /** 文件内容版本（meta.etag）；省略则不带 v */
        etag?: string
        /** 下载模式：追加 download=1 */
        download?: boolean
    } = {},
): string {
    const params = new URLSearchParams({ cwd, path: filePath })
    if (opts.download) params.set('download', '1')
    if (opts.etag) params.set('v', opts.etag)
    return `/api/machines/${machineId}/read-file?${params.toString()}`
}

/**
 * 会话文件寻址上下文（read-file 端点寻址所需字段的单源类型）：
 * machine 显式二元组优先（会话关闭后仍可达），缺 machine 回退 session（兼容老入口），
 * 双缺 = 无法构造任何端点（如新建会话页的恢复态）。
 */
export interface FileRefContext {
    sessionId?: string
    machineId?: string
    cwd?: string
}

/**
 * 从 (sessionId, 会话元数据) 投影寻址上下文——「挑哪些字段、怎么映射」的唯一出处
 * （元数据 path 即 cwd）。此前 ChatComposer / 气泡渲染各自手写同一投影，字段改名时
 * 必然漏改；所有消费方（画板回源、气泡图、附件缩略图）统一经此构造。
 */
export function fileRefContext(
    sessionId: string | undefined,
    metadata: { machineId?: string; path?: string } | null | undefined,
): FileRefContext {
    return { sessionId, machineId: metadata?.machineId, cwd: metadata?.path }
}

/**
 * 用户消息 image block → 可取数 URL（气泡 ImageView 渲染、composer 附件缩略图、
 * 画板重编辑取 PNG 共用）：blob:/data:/http(s):// 自足 URL 直接用（乐观回显的本地
 * 预览、网络图）；否则视为服务端 .mobi/uploads 路径，经 read-file 端点构造。
 * 服务端路径优先 machine 端点（会话关闭后仍可达），回退 session read-file（兼容老入口）；
 * env 不足以构造任何端点（machineId/cwd 与 sessionId 双缺，如新建会话页的恢复态）返回 null。
 * 判据来自 shared——Hub 的跨会话投递用同一份判断「这条消息是否依赖目标机器上的本地文件」，
 * 两处不一致会出现「渲染得出来却被拒」或「投递成功却是破图」
 */
export function resolveUserImageUrl(
    block: Pick<UserImageBlock, 'previewUrl' | 'source'>,
    env: FileRefContext,
): string | null {
    const raw = block.previewUrl ?? block.source.value
    if (isSelfContainedUrl(raw)) return raw
    if (env.machineId && env.cwd) return buildMachineReadFileUrl(env.machineId, env.cwd, raw)
    return env.sessionId ? buildReadFileUrl(env.sessionId, raw) : null
}
