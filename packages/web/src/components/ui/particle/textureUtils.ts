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

import * as THREE from 'three'
import type { ParticlePoint } from './types'

/** 纹理图片数据接口（Three.js Texture.image 的最小类型约束） */
interface TextureImageLike {
  width: number
  height: number
  src?: string
  id?: string
}

const textureDataCache = new Map<string, ImageData | null>()
const MAX_TEXTURE_CACHE_SIZE = 16

/**
 * 从 Three.js 纹理对象提取像素数据（带 LRU 缓存）
 */
export function getTextureData(texture: THREE.Texture): ImageData | null {
  const image = texture.image as TextureImageLike | undefined
  if (!image || !image.width || !image.height) return null

  const cacheKey = image.src || image.id || texture.uuid
  if (textureDataCache.has(cacheKey)) return textureDataCache.get(cacheKey)!

  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(texture.image as CanvasImageSource, 0, 0)
  const data = ctx.getImageData(0, 0, image.width, image.height)

  if (textureDataCache.size >= MAX_TEXTURE_CACHE_SIZE) {
    const firstKey = textureDataCache.keys().next().value
    if (firstKey !== undefined) textureDataCache.delete(firstKey)
  }
  textureDataCache.set(cacheKey, data)
  return data
}

/** 图片采样结果缓存（URL → 采样点） */
const imageSampleCache = new Map<string, ParticlePoint[]>()
const MAX_IMAGE_SAMPLE_CACHE = 8

/**
 * 从图片采样生成粒子点位（带缓存）
 */
export function sampleImagePoints(url: string): Promise<ParticlePoint[] | null> {
  if (imageSampleCache.has(url)) {
    return Promise.resolve(imageSampleCache.get(url)!)
  }

  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url

    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(null); return }

      const resolution = 200
      const aspect = img.width / img.height
      const drawWidth = aspect > 1 ? resolution : resolution * aspect
      const drawHeight = aspect > 1 ? resolution / aspect : resolution
      canvas.width = resolution
      canvas.height = resolution

      ctx.fillStyle = 'black'
      ctx.fillRect(0, 0, resolution, resolution)
      ctx.drawImage(img, (resolution - drawWidth) / 2, (resolution - drawHeight) / 2, drawWidth, drawHeight)

      const imgData = ctx.getImageData(0, 0, resolution, resolution).data
      const validPoints: ParticlePoint[] = []

      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const idx = (y * resolution + x) * 4
          const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2]
          if ((r + g + b) / 3 > 15) {
            validPoints.push({
              pos: [
                ((x / resolution) - 0.5) * 38,
                (0.5 - y / resolution) * 38,
                ((r + g + b) / 765 - 0.5) * 12,
              ],
              col: [r / 255, g / 255, b / 255],
            })
          }
        }
      }

      if (validPoints.length > 0) {
        if (imageSampleCache.size >= MAX_IMAGE_SAMPLE_CACHE) {
          const firstKey = imageSampleCache.keys().next().value
          if (firstKey !== undefined) imageSampleCache.delete(firstKey)
        }
        imageSampleCache.set(url, validPoints)
        resolve(validPoints)
      } else {
        resolve(null)
      }
    }

    img.onerror = () => resolve(null)
  })
}
