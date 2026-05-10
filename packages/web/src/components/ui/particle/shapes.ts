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
import type { ParticleShape, ParticlePoint } from './types'

/** 形状生成函数签名 */
type ShapeGenerator = (count: number) => ParticlePoint[]

/** 绿色（品牌色） */
const SHAPE_GREEN = new THREE.Color(0x00ff66)
/** 白色 */
const SHAPE_WHITE = new THREE.Color(0xffffff)

function pickColor(): [number, number, number] {
  const c = Math.random() > 0.7 ? SHAPE_GREEN : SHAPE_WHITE
  return [c.r, c.g, c.b]
}

function jitterPos(
  x: number, y: number, z: number, spread: number,
): [number, number, number] {
  return [
    x + (Math.random() - 0.5) * spread,
    y + (Math.random() - 0.5) * spread,
    z + (Math.random() - 0.5) * spread,
  ]
}

const heart: ShapeGenerator = (count) => {
  const points: ParticlePoint[] = []
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2
    const u = Math.random() * Math.PI * 2
    const v = Math.random() * Math.PI
    const scale = 18
    const x = ((scale * (16 * Math.pow(Math.sin(t), 3))) / 16) * Math.sin(v) * Math.cos(u)
    const y = (scale * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))) / 16
    const z = ((scale * (16 * Math.pow(Math.sin(t), 3))) / 16) * Math.sin(v) * Math.sin(u) * 0.8
    points.push({ pos: jitterPos(x, y, z, 3.0), col: pickColor() })
  }
  return points
}

const butterfly: ShapeGenerator = (count) => {
  const points: ParticlePoint[] = []
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 12
    const scale = 5.5
    const exp = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) - Math.pow(Math.sin(t / 12), 5)
    const x = Math.sin(t) * exp * scale
    const y = Math.cos(t) * exp * scale
    const z = (Math.random() - 0.5) * 15
    points.push({ pos: [x + (Math.random() - 0.5) * 2.5, y + (Math.random() - 0.5) * 2.5, z], col: pickColor() })
  }
  return points
}

const rose: ShapeGenerator = (count) => {
  const points: ParticlePoint[] = []
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 14
    const r = Math.cos(5 * t) * 15
    const x = r * Math.cos(t)
    const z = r * Math.sin(t)
    const y = (Math.random() - 0.5) * 20
    points.push({ pos: jitterPos(x, y, z, 2.0), col: pickColor() })
  }
  return points
}

const cube: ShapeGenerator = (count) => {
  const points: ParticlePoint[] = []
  const cubeSize = 18
  for (let i = 0; i < count; i++) {
    const face = Math.floor(Math.random() * 6)
    const a = (Math.random() - 0.5) * cubeSize
    const b = (Math.random() - 0.5) * cubeSize
    let x: number, y: number, z: number
    switch (face) {
      case 0: x = cubeSize / 2; y = a; z = b; break
      case 1: x = -cubeSize / 2; y = a; z = b; break
      case 2: x = a; y = cubeSize / 2; z = b; break
      case 3: x = a; y = -cubeSize / 2; z = b; break
      case 4: x = a; y = b; z = cubeSize / 2; break
      default: x = a; y = b; z = -cubeSize / 2; break
    }
    points.push({ pos: jitterPos(x, y, z, 2.0), col: pickColor() })
  }
  return points
}

const pyramid: ShapeGenerator = (count) => {
  const points: ParticlePoint[] = []
  const pyrHeight = 25
  const pyrBase = 20
  for (let i = 0; i < count; i++) {
    let x: number, y: number, z: number
    if (Math.random() < 0.3) {
      x = (Math.random() - 0.5) * pyrBase
      z = (Math.random() - 0.5) * pyrBase
      y = -pyrHeight / 2
    } else {
      const t = Math.random()
      x = (Math.random() - 0.5) * pyrBase * (1 - t)
      y = -pyrHeight / 2 + t * pyrHeight
      z = (Math.random() - 0.5) * pyrBase * (1 - t)
    }
    points.push({ pos: jitterPos(x, y, z, 2.0), col: pickColor() })
  }
  return points
}

const spiral: ShapeGenerator = (count) => {
  const points: ParticlePoint[] = []
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 10
    const r = 10 + Math.sin(t * 3) * 4
    const x = r * Math.cos(t)
    const z = r * Math.sin(t)
    const y = (i / count - 0.5) * 40
    points.push({ pos: jitterPos(x, y, z, 2.5), col: pickColor() })
  }
  return points
}

const star: ShapeGenerator = (count) => {
  const points: ParticlePoint[] = []
  const starPoints = 5
  const innerR = 8
  const outerR = 18
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const pointAngle = Math.floor(angle / ((Math.PI * 2) / starPoints)) * ((Math.PI * 2) / starPoints)
    const t = (angle - pointAngle) / (Math.PI / starPoints)
    const r = t < 1
      ? outerR - (outerR - innerR) * t
      : innerR + (outerR - innerR) * (t - 1)
    const x = r * Math.cos(angle)
    const z = r * Math.sin(angle)
    const y = (Math.random() - 0.5) * 15
    points.push({ pos: [x + (Math.random() - 0.5) * 2.0, y, z + (Math.random() - 0.5) * 2.0], col: pickColor() })
  }
  return points
}

const sphere: ShapeGenerator = (count) => {
  const points: ParticlePoint[] = []
  const r = 16
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const x = r * Math.sin(phi) * Math.cos(theta)
    const y = r * Math.sin(phi) * Math.sin(theta)
    const z = r * Math.cos(phi)
    points.push({ pos: jitterPos(x, y, z, 2.5), col: pickColor() })
  }
  return points
}

const dna: ShapeGenerator = (count) => {
  const points: ParticlePoint[] = []
  const r = 10
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 8
    const y = (i / count - 0.5) * 45
    let x: number, z: number
    const strand = i % 3
    if (strand === 0) {
      x = r * Math.cos(t)
      z = r * Math.sin(t)
    } else if (strand === 1) {
      x = r * Math.cos(t + Math.PI)
      z = r * Math.sin(t + Math.PI)
    } else {
      const barPos = Math.random()
      x = r * Math.cos(t) * (1 - barPos) + r * Math.cos(t + Math.PI) * barPos
      z = r * Math.sin(t) * (1 - barPos) + r * Math.sin(t + Math.PI) * barPos
    }
    points.push({ pos: jitterPos(x, y, z, 2.0), col: pickColor() })
  }
  return points
}

const infinity: ShapeGenerator = (count) => {
  const points: ParticlePoint[] = []
  const infScale = 25
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 6
    const denom = 1 + Math.sin(t) * Math.sin(t)
    const x = (infScale * Math.cos(t)) / denom
    const y = (infScale * Math.sin(t) * Math.cos(t)) / denom
    const z = (Math.random() - 0.5) * 15 + Math.sin(t * 2) * 5
    const thickness = 4.0
    const offsetX = (Math.random() - 0.5) * thickness
    const offsetY = (Math.random() - 0.5) * thickness + (Math.random() - 0.5) * 20 * 0.3
    const offsetZ = (Math.random() - 0.5) * thickness
    points.push({ pos: [x + offsetX, y + offsetY, z + offsetZ], col: pickColor() })
  }
  return points
}

const SHAPE_GENERATORS: Record<Exclude<ParticleShape, 'default'>, ShapeGenerator> = {
  heart, butterfly, rose, cube, pyramid, spiral, star, sphere, dna, infinity,
}

/**
 * 生成默认漩涡形状的粒子点位
 */
export function generateDefaultPoints(count: number): ParticlePoint[] {
  const points: ParticlePoint[] = []
  const greenColor = new THREE.Color(0x00ff66)
  const brightWhite = new THREE.Color(0xffffff)

  for (let i = 0; i < count; i++) {
    const t = (Math.random() - 0.5) * 5.0
    const angle = Math.random() * Math.PI * 2
    const radiusBase = 0.4 + Math.pow(Math.abs(t), 2.4)
    const radius = radiusBase * (0.75 + Math.random() * 0.55)
    const x = radius * Math.cos(angle) * 2.9
    const z = radius * Math.sin(angle) * 2.9
    const y = t * 7.5
    const color = Math.random() > 0.7 ? greenColor : brightWhite
    points.push({
      pos: [x, y, z],
      col: [color.r, color.g, color.b],
    })
  }
  return points
}

/**
 * 生成指定形状的粒子点位
 */
export function generateShapePoints(
  shapeName: ParticleShape,
  particleCount: number,
): ParticlePoint[] {
  if (shapeName === 'default') return []
  return SHAPE_GENERATORS[shapeName](particleCount)
}
