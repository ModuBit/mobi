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
 * 草图像素数据的进出口封装（画板特性）。
 *
 * 产物形态：单个 `.excalidraw.png`——excalidraw 的 exportEmbedScene 把 scene JSON
 * 内嵌进 PNG 的 tEXt chunk（key `application/x.excalidraw`），loadFromBlob 直接从
 * PNG 恢复场景（官方格式，自描述、换画板 SDK 仍可识别）。
 *
 * 导入导出本身依赖浏览器 canvas（excalidraw 动态 import，惰性拉依赖），
 * 可在 jsdom 断言的纯函数（命名 / 尺寸约束 / 常量）见文件头部导出。
 */

import type { SketchMark } from '@mobi/shared'

/** 画板引擎标识：shared image block `sketch.format` 与文件双扩展名的单一来源 */
export const SKETCH_FORMAT = 'excalidraw'

/** shared image block `sketch` 字段的标准值（画板产物恒为此值） */
export const SKETCH_MARK: SketchMark = { format: SKETCH_FORMAT }

/** 导出长边上限：图片 token 按像素尺寸计（与字节无关），限长边才是真正省 token；
 *  ~2000px 在 API 视觉识别最优区间（1568px 长边附近）之上留出裁切余量 */
export const SKETCH_MAX_EDGE = 2000

/** 两位补零 */
const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 本地时间戳段：20260919-090503 */
function sketchStamp(date: Date): string {
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
}

/** 草图文件名：`sketch-<本地时间戳>.excalidraw.png`（官方约定双扩展名，格式可从扩展名与 chunk key
 * 双重识别）。ASCII 前缀：CLI 落盘 sanitize（`[^\w\-.]→_`）会把中文逐字蹂成 `_`，产物名走通用
 * 上传管线，前缀须在其字符集内 */
export function sketchFilename(date: Date = new Date()): string {
    return `sketch-${sketchStamp(date)}.excalidraw.png`
}

/**
 * exportToBlob 的 getDimensions 产物：长边超限时等比压低输出画布像素
 * （返回的 width/height 即导出 canvas 尺寸，scale 供 excalidraw 内部换算）。
 */
export function sketchExportDimensions(width: number, height: number): { width: number; height: number; scale: number } {
    const scale = Math.min(1, SKETCH_MAX_EDGE / Math.max(width, height))
    return { width: Math.round(width * scale), height: Math.round(height * scale), scale }
}

/** 画板引擎的 excalidraw API 类型（仅类型引用，不把依赖拉进主 bundle） */
type SketchEditor = {
    getSceneElements: () => readonly unknown[]
    getAppState: () => Record<string, unknown>
    getFiles: () => Record<string, unknown>
}

/**
 * 导出草图为单文件 PNG（scene 内嵌）。
 * excalidraw 惰性 import：调用点（完成按钮）才拉依赖。
 */
export async function exportSketch(editor: SketchEditor): Promise<Blob> {
    const { exportToBlob } = await import('@excalidraw/excalidraw')
    const appState = editor.getAppState() as Parameters<typeof exportToBlob>[0]['appState']
    const elements = editor.getSceneElements() as Parameters<typeof exportToBlob>[0]['elements']
    const files = editor.getFiles() as Parameters<typeof exportToBlob>[0]['files']
    return await exportToBlob({
        elements,
        appState: { ...appState, exportEmbedScene: true, exportBackground: true },
        files,
        mimeType: 'image/png',
        getDimensions: sketchExportDimensions,
    })
}

/** 从内嵌 scene 的 PNG 恢复画板场景（重编辑载入）。 */
export async function loadSketch(png: Blob): Promise<{ elements: readonly unknown[]; appState: Record<string, unknown>; files: Record<string, unknown> }> {
    const { loadFromBlob } = await import('@excalidraw/excalidraw')
    const scene = await loadFromBlob(png, null, null)
    return {
        elements: scene.elements ?? [],
        appState: (scene.appState ?? {}) as Record<string, unknown>,
        files: (scene.files ?? {}) as Record<string, unknown>,
    }
}
