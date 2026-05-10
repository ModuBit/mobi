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

/** 粒子形状类型 */
export type ParticleShape =
  | 'default'
  | 'heart'
  | 'butterfly'
  | 'rose'
  | 'cube'
  | 'pyramid'
  | 'spiral'
  | 'star'
  | 'sphere'
  | 'dna'
  | 'infinity'

/** 粒子特效类型 */
export type ParticleEffect =
  | 'default'
  | 'scatter'
  | 'explode'
  | 'vortex'
  | 'pulse'
  | 'wave'

/** 粒子点位数据 */
export interface ParticlePoint {
  pos: [number, number, number]
  col: [number, number, number]
}

/** ParticleCanvas 组件属性 */
export interface ParticleCanvasProps {
  /** 粒子形状，默认 'default' */
  shape?: ParticleShape
  /** 粒子特效，默认 'default' */
  effect?: ParticleEffect
  /** 粒子大小，默认 200 */
  particleSize?: number
  /**
   * 粒子数量，默认 90000
   * 注意：仅在首次渲染时生效，不支持运行时动态变更
   */
  particleCount?: number
  /** 图片 URL，优先级高于 shape */
  imageUrl?: string
  /** 模型 URL，优先级高于 imageUrl */
  modelUrl?: string
  /** 是否启用鼠标/键盘交互，默认 false */
  interactionEnabled?: boolean
  /** 容器自定义 className */
  className?: string
  /** 容器自定义 style */
  style?: React.CSSProperties
}
