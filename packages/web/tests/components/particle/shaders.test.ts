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
import { VERTEX_SHADER, FRAGMENT_SHADER, EFFECT_MODE_MAP } from '@/components/ui/particle/shaders'

describe('shaders', () => {
  it('VERTEX_SHADER 包含 main 函数', () => {
    expect(VERTEX_SHADER).toContain('void main()')
  })

  it('VERTEX_SHADER 声明了所有 uniform', () => {
    const floatUniforms = ['uTime', 'uMorph', 'uPointSize', 'uEffectIntensity', 'uExplosionTime']
    for (const u of floatUniforms) {
      expect(VERTEX_SHADER).toContain(`uniform float ${u};`)
    }
    expect(VERTEX_SHADER).toContain('uniform int uEffectMode;')
  })

  it('VERTEX_SHADER 声明了所有 attribute', () => {
    const attrs = ['targetPosition', 'targetColor', 'color', 'randomOffset']
    for (const a of attrs) {
      expect(VERTEX_SHADER).toContain(`attribute vec3 ${a};`)
    }
  })

  it('FRAGMENT_SHADER 包含 main 函数', () => {
    expect(FRAGMENT_SHADER).toContain('void main()')
  })

  it('FRAGMENT_SHADER 声明了 uTime 和 varying', () => {
    expect(FRAGMENT_SHADER).toContain('uniform float uTime;')
    expect(FRAGMENT_SHADER).toContain('varying vec3 vColor;')
    expect(FRAGMENT_SHADER).toContain('varying float vDistance;')
  })
})

describe('EFFECT_MODE_MAP', () => {
  it('包含 6 种特效模式', () => {
    expect(Object.keys(EFFECT_MODE_MAP)).toHaveLength(6)
  })

  it('每种模式映射到唯一的数字', () => {
    const values = Object.values(EFFECT_MODE_MAP)
    expect(new Set(values).size).toBe(6)
  })

  it('default 映射到 0', () => {
    expect(EFFECT_MODE_MAP.default).toBe(0)
  })
})
