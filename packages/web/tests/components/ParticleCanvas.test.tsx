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
 * ParticleCanvas 组件测试
 * 测试粒子动画画布的渲染、props 传递和资源清理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ParticleCanvas } from '@/components/ui/ParticleCanvas'

// 使用 function 关键字以确保可以作为构造函数调用
vi.mock('three', () => {
  const Scene = vi.fn(function () {
    return { add: vi.fn() }
  })
  const PerspectiveCamera = vi.fn(function () {
    return {
      position: { set: vi.fn() },
      lookAt: vi.fn(),
      aspect: 1,
      updateProjectionMatrix: vi.fn(),
    }
  })
  const WebGLRenderer = vi.fn(function () {
    return {
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      setClearColor: vi.fn(),
      render: vi.fn(),
      domElement: document.createElement('canvas'),
      dispose: vi.fn(),
    }
  })
  const BufferGeometry = vi.fn(function () {
    return {
      setAttribute: vi.fn(),
      attributes: {},
      dispose: vi.fn(),
    }
  })
  const BufferAttribute = vi.fn(function () {
    return {}
  })
  const ShaderMaterial = vi.fn(function () {
    return {
      uniforms: {
        uTime: { value: 0 },
        uMorph: { value: 0 },
        uPointSize: { value: 200 },
        uEffectMode: { value: 0 },
        uEffectIntensity: { value: 0 },
        uExplosionTime: { value: 0 },
      },
      dispose: vi.fn(),
    }
  })
  const Points = vi.fn(function () {
    return { rotation: { x: 0, y: 0, z: 0 } }
  })
  const Color = vi.fn(function () {
    return { r: 1, g: 1, b: 1 }
  })
  const Vector3 = vi.fn(function () {
    return {
      addScaledVector: vi.fn(),
      copy: vi.fn(),
      getWorldDirection: vi.fn(),
    }
  })
  const Box3 = vi.fn(function () {
    return {
      setFromObject: vi.fn(function () {
        return {
          getCenter: vi.fn(),
          getSize: vi.fn(),
        }
      }),
    }
  })
  const AdditiveBlending = 200
  return {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    BufferGeometry,
    BufferAttribute,
    ShaderMaterial,
    Points,
    Color,
    Vector3,
    AdditiveBlending,
    Box3,
  }
})

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: vi.fn(function () {
    return { load: vi.fn() }
  }),
}))

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(function () {
    return 1
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

describe('ParticleCanvas', () => {
  it('渲染容器 div', () => {
    const { container } = render(<ParticleCanvas />)
    const div = container.firstChild as HTMLElement
    expect(div).toBeTruthy()
    expect(div.tagName.toLowerCase()).toBe('div')
  })

  it('接受 className 和 style props', () => {
    const { container } = render(
      <ParticleCanvas
        className="test-class"
        style={{ backgroundColor: 'red' }}
      />,
    )
    const div = container.firstChild as HTMLElement
    expect(div.classList.contains('test-class')).toBe(true)
    expect(div.style.backgroundColor).toBe('red')
  })

  it('卸载时不报错（资源清理）', () => {
    const { unmount } = render(<ParticleCanvas />)
    expect(() => unmount()).not.toThrow()
  })

  it('使用默认 props 渲染', () => {
    const { container } = render(<ParticleCanvas />)
    const div = container.firstChild as HTMLElement
    expect(div).toBeTruthy()
    expect(div.style.width).toBe('100%')
    expect(div.style.height).toBe('100%')
  })

  it('接受不同的 shape prop', () => {
    const shapes = ['heart', 'butterfly', 'rose', 'cube', 'pyramid', 'spiral', 'star', 'sphere', 'dna', 'infinity'] as const
    for (const shape of shapes) {
      const { unmount, container } = render(
        <ParticleCanvas shape={shape} />,
      )
      const div = container.firstChild as HTMLElement
      expect(div).toBeTruthy()
      unmount()
    }
  })
})
