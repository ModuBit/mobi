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

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VERTEX_SHADER, FRAGMENT_SHADER, EFFECT_MODE_MAP } from './particle/shaders'
import { generateDefaultPoints, generateShapePoints } from './particle/shapes'
import { getTextureData, sampleImagePoints } from './particle/textureUtils'
import type { ParticleShape, ParticleEffect, ParticleCanvasProps, ParticlePoint } from './particle/types'

export type { ParticleShape, ParticleEffect, ParticleCanvasProps }
export type { ParticlePoint }

interface SceneData {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  points: THREE.Points
  geometry: THREE.BufferGeometry
  material: THREE.ShaderMaterial
  originalPositions: Float32Array
  targetPositions: Float32Array
  originalColors: Float32Array
  targetColors: Float32Array
}

/** 将粒子点位写入 targetPosition/targetColor 缓冲区 */
function applyPointsToBuffer(sd: SceneData, points: ParticlePoint[]) {
  if (points.length === 0) return
  const count = sd.targetPositions.length / 3
  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    const point = points[i % points.length]
    sd.targetPositions[i3] = point.pos[0]
    sd.targetPositions[i3 + 1] = point.pos[1]
    sd.targetPositions[i3 + 2] = point.pos[2]
    sd.targetColors[i3] = point.col[0]
    sd.targetColors[i3 + 1] = point.col[1]
    sd.targetColors[i3 + 2] = point.col[2]
  }
  sd.geometry.attributes.targetPosition.needsUpdate = true
  sd.geometry.attributes.targetColor.needsUpdate = true
}

/** 将带抖动的图片采样点写入缓冲区 */
function applyImagePointsToBuffer(sd: SceneData, points: ParticlePoint[]) {
  const count = sd.targetPositions.length / 3
  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    const point = points[i % points.length]
    sd.targetPositions[i3] = point.pos[0] + (Math.random() - 0.5) * 0.4
    sd.targetPositions[i3 + 1] = point.pos[1] + (Math.random() - 0.5) * 0.4
    sd.targetPositions[i3 + 2] = point.pos[2] + (Math.random() - 0.5) * 1.5
    sd.targetColors[i3] = point.col[0]
    sd.targetColors[i3 + 1] = point.col[1]
    sd.targetColors[i3 + 2] = point.col[2]
  }
  sd.geometry.attributes.targetPosition.needsUpdate = true
  sd.geometry.attributes.targetColor.needsUpdate = true
}

/** 处理 GLTF 模型：采样顶点生成粒子位置和颜色 */
function processModel(sd: SceneData, url: string) {
  if (!url) return
  const loader = new GLTFLoader()
  loader.load(url, (gltf) => {
    const positions: number[] = []
    const colors: number[] = []
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mesh = child
      const geo = mesh.geometry
      const posAttr = geo.attributes.position
      const uvAttr = geo.attributes.uv
      const colorAttr = geo.attributes.color
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const texture = (material as THREE.MeshStandardMaterial)?.map
      const imageData = texture ? getTextureData(texture) : null
      const meshColor = (material as THREE.MeshStandardMaterial)?.color ?? new THREE.Color(0xffffff)
      const reusableVec = new THREE.Vector3()
      const reusableCol = new THREE.Color(1, 1, 1)
      for (let i = 0; i < posAttr.count; i++) {
        reusableVec.fromBufferAttribute(posAttr, i)
        reusableVec.applyMatrix4(mesh.matrixWorld)
        positions.push(reusableVec.x, reusableVec.y, reusableVec.z)
        reusableCol.set(1, 1, 1)
        if (imageData && uvAttr) {
          const u = ((uvAttr.getX(i) % 1) + 1) % 1
          const uv = ((uvAttr.getY(i) % 1) + 1) % 1
          const px = Math.floor(u * (imageData.width - 1))
          const py = Math.floor((1 - uv) * (imageData.height - 1))
          const idx = (py * imageData.width + px) * 4
          reusableCol.setRGB(
            imageData.data[idx] / 255,
            imageData.data[idx + 1] / 255,
            imageData.data[idx + 2] / 255,
          )
          reusableCol.multiply(meshColor)
        } else if (colorAttr) {
          reusableCol.fromBufferAttribute(colorAttr, i)
        } else {
          reusableCol.copy(meshColor)
        }
        colors.push(reusableCol.r, reusableCol.g, reusableCol.b)
      }
    })
    if (positions.length > 0) {
      const box = new THREE.Box3().setFromObject(gltf.scene)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const scale = 30 / maxDim
      const count = sd.targetPositions.length / 3
      for (let i = 0; i < count; i++) {
        const i3 = i * 3
        const pIndex = Math.floor(Math.random() * (positions.length / 3)) * 3
        const jitter = 0.15
        sd.targetPositions[i3] = (positions[pIndex] - center.x) * scale + (Math.random() - 0.5) * jitter
        sd.targetPositions[i3 + 1] = (positions[pIndex + 1] - center.y) * scale + (Math.random() - 0.5) * jitter
        sd.targetPositions[i3 + 2] = (positions[pIndex + 2] - center.z) * scale + (Math.random() - 0.5) * jitter
        sd.targetColors[i3] = colors[pIndex]
        sd.targetColors[i3 + 1] = colors[pIndex + 1]
        sd.targetColors[i3 + 2] = colors[pIndex + 2]
      }
      sd.geometry.attributes.targetPosition.needsUpdate = true
      sd.geometry.attributes.targetColor.needsUpdate = true
    }
  })
}

/** 加载内容源（modelUrl > imageUrl > shape），返回取消函数 */
function loadContentSource(
  sd: SceneData,
  source: {
    modelUrl?: string
    imageUrl?: string
    shape?: ParticleShape
    particleCount: number
    applyDefault: boolean
  },
): () => void {
  let cancelled = false

  if (source.modelUrl) {
    processModel(sd, source.modelUrl)
  } else if (source.imageUrl) {
    const url = source.imageUrl
    sampleImagePoints(url).then((points) => {
      if (cancelled || !points) return
      applyImagePointsToBuffer(sd, points)
    })
  } else if (source.shape && source.shape !== 'default') {
    const shapePoints = generateShapePoints(source.shape, source.particleCount)
    applyPointsToBuffer(sd, shapePoints)
  } else if (source.applyDefault) {
    const orig = sd.originalPositions
    const origC = sd.originalColors
    const count = sd.targetPositions.length / 3
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      sd.targetPositions[i3] = orig[i3]
      sd.targetPositions[i3 + 1] = orig[i3 + 1]
      sd.targetPositions[i3 + 2] = orig[i3 + 2]
      sd.targetColors[i3] = origC[i3]
      sd.targetColors[i3 + 1] = origC[i3 + 1]
      sd.targetColors[i3 + 2] = origC[i3 + 2]
    }
    sd.geometry.attributes.targetPosition.needsUpdate = true
    sd.geometry.attributes.targetColor.needsUpdate = true
  }

  return () => { cancelled = true }
}

/**
 * 粒子动画画布组件
 *
 * 基于 Three.js 的粒子动画系统，支持多种形状、特效和自定义输入源。
 * 形状优先级：modelUrl > imageUrl > shape
 */
export function ParticleCanvas({
  shape = 'default',
  effect = 'default',
  particleSize = 200,
  particleCount = 90000,
  imageUrl,
  modelUrl,
  interactionEnabled = false,
  className,
  style,
}: ParticleCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneDataRef = useRef<SceneData | null>(null)
  const animationIdRef = useRef<number>(0)

  const propsRef = useRef({
    shape, effect, particleSize, particleCount, imageUrl, modelUrl, interactionEnabled,
  })

  const interactionStateRef = useRef({
    target: new THREE.Vector3(0, 0, 0),
    yaw: 0, pitch: 0,
    distance: 45, minDistance: 20, maxDistance: 100,
    isLeftDragging: false, isRightDragging: false,
    previousX: 0, previousY: 0,
    isDragging: false, objPreviousX: 0, objPreviousY: 0,
  })

  const animStateRef = useRef({
    time: 0,
    morphFactor: 0,
    effectIntensity: 0,
    targetEffectIntensity: 0,
    explosionTriggered: false,
    explosionTime: 0,
  })

  const destroyedRef = useRef(false)

  propsRef.current = { shape, effect, particleSize, particleCount, imageUrl, modelUrl, interactionEnabled }

  const updateCameraFromState = (camera: THREE.PerspectiveCamera) => {
    const s = interactionStateRef.current
    const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch)
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw)
    camera.position.set(
      s.target.x + s.distance * sy * cp,
      s.target.y + s.distance * sp,
      s.target.z + s.distance * cy * cp,
    )
    camera.lookAt(s.target)
  }

  useEffect(() => {
    destroyedRef.current = false
    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight
    if (width === 0 || height === 0) return

    const currentParticleCount = propsRef.current.particleCount

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 1000)
    camera.position.z = 45
    interactionStateRef.current.target = new THREE.Vector3(0, 0, 0)
    updateCameraFromState(camera)

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(currentParticleCount * 3)
    const targetPositions = new Float32Array(currentParticleCount * 3)
    const colors = new Float32Array(currentParticleCount * 3)
    const targetColors = new Float32Array(currentParticleCount * 3)
    const randomOffsets = new Float32Array(currentParticleCount * 3)

    const defaultPoints = generateDefaultPoints(currentParticleCount)
    for (let i = 0; i < currentParticleCount; i++) {
      const i3 = i * 3
      positions[i3] = defaultPoints[i].pos[0]
      positions[i3 + 1] = defaultPoints[i].pos[1]
      positions[i3 + 2] = defaultPoints[i].pos[2]
      targetPositions[i3] = defaultPoints[i].pos[0]
      targetPositions[i3 + 1] = defaultPoints[i].pos[1]
      targetPositions[i3 + 2] = defaultPoints[i].pos[2]
      randomOffsets[i3] = (Math.random() - 0.5) * 2
      randomOffsets[i3 + 1] = (Math.random() - 0.5) * 2
      randomOffsets[i3 + 2] = (Math.random() - 0.5) * 2
      colors[i3] = defaultPoints[i].col[0]
      colors[i3 + 1] = defaultPoints[i].col[1]
      colors[i3 + 2] = defaultPoints[i].col[2]
      targetColors[i3] = defaultPoints[i].col[0]
      targetColors[i3 + 1] = defaultPoints[i].col[1]
      targetColors[i3 + 2] = defaultPoints[i].col[2]
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('targetPosition', new THREE.BufferAttribute(targetPositions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('targetColor', new THREE.BufferAttribute(targetColors, 3))
    geometry.setAttribute('randomOffset', new THREE.BufferAttribute(randomOffsets, 3))

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uMorph: { value: 0 },
        uPointSize: { value: propsRef.current.particleSize },
        uEffectMode: { value: EFFECT_MODE_MAP[effect] },
        uEffectIntensity: { value: 0 },
        uExplosionTime: { value: 0 },
      },
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    const points = new THREE.Points(geometry, material)
    scene.add(points)

    const sd: SceneData = {
      scene, camera, renderer, points, geometry, material,
      originalPositions: positions.slice(),
      targetPositions,
      originalColors: colors.slice(),
      targetColors,
    }
    sceneDataRef.current = sd

    const { modelUrl: mUrl, imageUrl: iUrl, shape: s } = propsRef.current
    const cancelInitLoad = loadContentSource(sd, {
      modelUrl: mUrl, imageUrl: iUrl, shape: s,
      particleCount: currentParticleCount,
      applyDefault: false,
    })

    const animate = () => {
      if (destroyedRef.current) return
      animationIdRef.current = requestAnimationFrame(animate)
      const anim = animStateRef.current
      const props = propsRef.current

      anim.time += 0.008
      if (!sceneDataRef.current) return

      const { renderer: r, scene: sc, camera: cam, points: pts, material: mat } = sceneDataRef.current

      if (props.interactionEnabled) {
        updateCameraFromState(cam)
      } else {
        let rotationSpeed = 0.0025
        if (props.effect === 'vortex') {
          rotationSpeed = 0.008 * (0.5 + anim.effectIntensity)
        } else if (props.effect === 'explode' && anim.explosionTriggered) {
          rotationSpeed = 0.001
        }
        pts.rotation.y += rotationSpeed
        pts.rotation.z += 0.001
        pts.rotation.x = Math.sin(anim.time * 0.15) * 0.12
      }

      mat.uniforms.uTime.value = anim.time
      const targetMorph = props.imageUrl || props.modelUrl ? 1.0 : 0.0
      anim.morphFactor += (targetMorph - anim.morphFactor) * 0.05
      mat.uniforms.uMorph.value = anim.morphFactor
      anim.effectIntensity += (anim.targetEffectIntensity - anim.effectIntensity) * 0.08
      mat.uniforms.uEffectIntensity.value = anim.effectIntensity
      if (anim.explosionTriggered) {
        anim.explosionTime += 0.016
        if (anim.explosionTime > 2.0) anim.explosionTime = 0
      }
      mat.uniforms.uExplosionTime.value = anim.explosionTime

      r.render(sc, cam)
    }
    animate()

    const handleResize = () => {
      if (!sceneDataRef.current || !container) return
      const w = container.clientWidth
      const h = container.clientHeight
      sceneDataRef.current.camera.aspect = w / h
      sceneDataRef.current.camera.updateProjectionMatrix()
      sceneDataRef.current.renderer.setSize(w, h)
    }
    window.addEventListener('resize', handleResize)

    const handleMouseDown = (e: MouseEvent) => {
      if (!propsRef.current.interactionEnabled) return
      const s = interactionStateRef.current
      if (e.button === 0) s.isLeftDragging = true
      else if (e.button === 2) s.isRightDragging = true
      s.previousX = e.clientX
      s.previousY = e.clientY
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!sceneDataRef.current || !propsRef.current.interactionEnabled) return
      const s = interactionStateRef.current
      const deltaX = e.clientX - s.previousX
      const deltaY = e.clientY - s.previousY
      if (s.isLeftDragging) {
        s.yaw -= deltaX * 0.005
        s.pitch -= deltaY * 0.005
        const maxPitch = Math.PI * 0.499
        s.pitch = Math.max(-maxPitch, Math.min(maxPitch, s.pitch))
      } else if (s.isRightDragging) {
        const panScale = s.distance * 0.002
        const forward = new THREE.Vector3()
        sceneDataRef.current.camera.getWorldDirection(forward)
        const right = new THREE.Vector3()
          .crossVectors(forward, sceneDataRef.current.camera.up)
          .normalize()
        const up = new THREE.Vector3()
          .copy(sceneDataRef.current.camera.up)
          .normalize()
        s.target.addScaledVector(right, -deltaX * panScale)
        s.target.addScaledVector(up, deltaY * panScale)
      }
      s.previousX = e.clientX
      s.previousY = e.clientY
    }

    const handleMouseUp = () => {
      interactionStateRef.current.isLeftDragging = false
      interactionStateRef.current.isRightDragging = false
    }

    const handleWheel = (e: WheelEvent) => {
      if (!propsRef.current.interactionEnabled) return
      e.preventDefault()
      const s = interactionStateRef.current
      s.distance += e.deltaY * 0.03
      s.distance = Math.max(s.minDistance, Math.min(s.maxDistance, s.distance))
    }

    const handleContextMenu = (e: Event) => {
      if (propsRef.current.interactionEnabled) e.preventDefault()
    }

    renderer.domElement.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false })
    renderer.domElement.addEventListener('contextmenu', handleContextMenu)

    return () => {
      destroyedRef.current = true
      cancelInitLoad()
      cancelAnimationFrame(animationIdRef.current)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)

      geometry.dispose()
      material.dispose()
      renderer.dispose()

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }

      sceneDataRef.current = null
    }
  }, [])

  useEffect(() => {
    const sd = sceneDataRef.current
    if (!sd) return

    const { shape: s, effect: e, imageUrl: iUrl, modelUrl: mUrl, particleSize: ps } = propsRef.current

    sd.material.uniforms.uPointSize.value = ps
    sd.material.uniforms.uEffectMode.value = EFFECT_MODE_MAP[e] ?? 0

    if (e === 'explode') {
      animStateRef.current.explosionTriggered = true
      animStateRef.current.targetEffectIntensity = 1
    } else {
      animStateRef.current.explosionTriggered = false
      animStateRef.current.targetEffectIntensity = e === 'default' ? 0 : 1
    }

    const count = sd.targetPositions.length / 3
    loadContentSource(sd, {
      modelUrl: mUrl, imageUrl: iUrl, shape: s,
      particleCount: count,
      applyDefault: true,
    })
  }, [shape, effect, particleSize, imageUrl, modelUrl, interactionEnabled])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%', ...style }}
    />
  )
}
