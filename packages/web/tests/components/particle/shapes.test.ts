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

import { describe, it, expect } from 'vitest'
import { generateDefaultPoints, generateShapePoints } from '@/components/ui/particle/shapes'

describe('generateDefaultPoints', () => {
  it('生成指定数量的粒子点', () => {
    const points = generateDefaultPoints(100)
    expect(points).toHaveLength(100)
  })

  it('每个点包含 pos（3 个数）和 col（3 个数）', () => {
    const [point] = generateDefaultPoints(1)
    expect(point.pos).toHaveLength(3)
    expect(point.col).toHaveLength(3)
    point.pos.forEach((v) => expect(typeof v).toBe('number'))
    point.col.forEach((v) => expect(typeof v).toBe('number'))
  })

  it('颜色值在 [0, 1] 范围内', () => {
    const points = generateDefaultPoints(200)
    for (const p of points) {
      p.col.forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      })
    }
  })
})

describe('generateShapePoints', () => {
  const shapes = ['heart', 'butterfly', 'rose', 'cube', 'pyramid', 'spiral', 'star', 'sphere', 'dna', 'infinity'] as const

  it('default 返回空数组', () => {
    expect(generateShapePoints('default', 100)).toHaveLength(0)
  })

  for (const shape of shapes) {
    it(`${shape} 生成指定数量的粒子点`, () => {
      const points = generateShapePoints(shape, 50)
      expect(points).toHaveLength(50)
      const [point] = points
      expect(point.pos).toHaveLength(3)
      expect(point.col).toHaveLength(3)
    })
  }
})
