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

/**
 * 粒子形状类型
 */
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

/**
 * 粒子特效类型
 */
export type ParticleEffect =
  | 'default'
  | 'scatter'
  | 'explode'
  | 'vortex'
  | 'pulse'
  | 'wave'

/**
 * ParticleCanvas 组件属性
 */
export interface ParticleCanvasProps {
  /** 粒子形状，默认 'default' */
  shape?: ParticleShape
  /** 粒子特效，默认 'default' */
  effect?: ParticleEffect
  /** 粒子大小，默认 200 */
  particleSize?: number
  /** 粒子数量，默认 90000 */
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

/** 特效模式映射 */
const EFFECT_MODE_MAP: Record<ParticleEffect, number> = {
  default: 0,
  scatter: 1,
  explode: 2,
  vortex: 3,
  pulse: 4,
  wave: 5,
}

/** 顶点着色器 */
const VERTEX_SHADER = `uniform float uTime;uniform float uMorph;uniform float uPointSize;uniform int uEffectMode;uniform float uEffectIntensity;uniform float uExplosionTime;attribute vec3 targetPosition;attribute vec3 targetColor;attribute vec3 color;attribute vec3 randomOffset;varying vec3 vColor;varying float vDistance;vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}float snoise(vec2 v){const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod289(i);vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0)) + i.x + vec3(0.0,i1.x,1.0));vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);m=m*m;m=m*m;vec3 x=2.0*fract(p*C.www)-1.0;vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;return 130.0*dot(m,g);}void main(){vColor=mix(color,targetColor,uMorph);vec3 pos=mix(position,targetPosition,uMorph);vec3 originalPos=pos;float effectMix=uEffectIntensity;if(uEffectMode==0){float noise=sin(uTime*1.5+position.x*0.3)*cos(uTime*1.5+position.y*0.3);pos+=normalize(pos)*noise*(0.2*(1.0-uMorph));pos.x+=sin(uTime*0.3+position.z)*0.1;pos.y+=cos(uTime*0.3+position.x)*0.1;}else if(uEffectMode==1){vec3 scatterDir=normalize(pos+randomOffset*0.5);float scatterDist=length(pos)*0.5+randomOffset.x*3.0;vec3 scattered=pos+scatterDir*scatterDist*effectMix*2.5;float turb=snoise(pos.xy*0.3+uTime*0.5);scattered+=vec3(turb,turb*0.5,turb*0.3)*effectMix*1.5;pos=mix(originalPos,scattered,effectMix);}else if(uEffectMode==2){float explodeProgress=min(uExplosionTime*2.0,1.0);float returnProgress=max(0.0,(uExplosionTime-0.5)*2.0);vec3 explodeDir=normalize(pos+randomOffset);float explodeDist=(5.0+randomOffset.x*8.0)*sin(explodeProgress*3.14159);vec3 exploded=originalPos+explodeDir*explodeDist*effectMix;float spin=explodeProgress*6.28318*(0.5+randomOffset.y);exploded.x+=cos(spin)*explodeDist*0.3;exploded.z+=sin(spin)*explodeDist*0.3;pos=mix(originalPos,exploded,effectMix*(1.0-returnProgress*0.7));}else if(uEffectMode==3){float angle=atan(pos.z,pos.x);float radius=length(pos.xz);float height=pos.y;float spiralSpeed=uTime*2.0+height*0.3;float newAngle=angle+spiralSpeed*effectMix;float vortexPull=(1.0-abs(height)/20.0)*effectMix;float newRadius=radius*(1.0-vortexPull*0.5)+sin(uTime*3.0+height)*effectMix;float lift=effectMix*5.0*(1.0-radius/20.0);pos.x=cos(newAngle)*newRadius;pos.z=sin(newAngle)*newRadius;pos.y=height+lift*sin(uTime+radius);}else if(uEffectMode==4){float pulsePhase=uTime*2.5;float pulseFactor=1.0+sin(pulsePhase)*0.4*effectMix;float waveFactor=sin(pulsePhase+length(pos)*0.3)*0.3*effectMix;vec3 pulsed=pos*pulseFactor;pulsed+=normalize(pos)*waveFactor*3.0;float colorPulse=sin(pulsePhase*0.5)*0.5+0.5;vColor=mix(vColor,vec3(1.0,0.4,0.8),colorPulse*effectMix*0.3);pos=pulsed;}else if(uEffectMode==5){float waveX=sin(pos.x*0.5+uTime*2.0)*effectMix*3.0;float waveZ=cos(pos.z*0.5+uTime*1.5)*effectMix*2.0;float waveY=sin(pos.x*0.3+pos.z*0.3+uTime*2.5)*effectMix*4.0;waveY+=sin(pos.x*0.8-uTime*1.8)*effectMix*1.5;waveY+=cos(pos.z*0.6+uTime*1.2)*effectMix*1.0;pos.x+=waveX*0.3;pos.y+=waveY;pos.z+=waveZ*0.3;}vec4 mvPosition=modelViewMatrix*vec4(pos,1.0);float dist=length(pos);vDistance=dist;float sizeMultiplier=1.0;if(uEffectMode==2&&effectMix>0.1)sizeMultiplier=1.0+sin(uExplosionTime*10.0)*0.3;if(uEffectMode==4)sizeMultiplier=1.0+sin(uTime*2.5)*0.2*effectMix;gl_PointSize=(uPointSize/-mvPosition.z)*(1.2+sin(uTime*3.0+dist*0.15)*0.5)*sizeMultiplier;gl_Position=projectionMatrix*mvPosition;}`

/** 片段着色器 */
const FRAGMENT_SHADER = `uniform float uTime;varying vec3 vColor;varying float vDistance;void main(){float dist=distance(gl_PointCoord,vec2(0.5));if(dist>0.5)discard;float strength=pow(1.0-dist*2.0,1.6);vec3 finalColor=vColor*2.0;float alpha=strength*(0.8+sin(vDistance*0.3+uTime)*0.2);gl_FragColor=vec4(finalColor,alpha);}`

/**
 * 生成指定形状的粒子点位数据
 */
function generateShapePoints(
  shapeName: ParticleShape,
  particleCount: number,
): Array<{ pos: [number, number, number]; col: [number, number, number] }> {
  const points: Array<{
    pos: [number, number, number]
    col: [number, number, number]
  }> = []
  const shapeGreen = new THREE.Color(0x00ff66)
  const shapeWhite = new THREE.Color(0xffffff)

  switch (shapeName) {
    case 'heart':
      for (let i = 0; i < particleCount; i++) {
        const t = (i / particleCount) * Math.PI * 2
        const u = Math.random() * Math.PI * 2
        const v = Math.random() * Math.PI
        const scale = 18
        const x =
          ((scale * (16 * Math.pow(Math.sin(t), 3))) / 16) *
          Math.sin(v) *
          Math.cos(u)
        const y =
          (scale *
            (13 * Math.cos(t) -
              5 * Math.cos(2 * t) -
              2 * Math.cos(3 * t) -
              Math.cos(4 * t))) /
          16
        const z =
          ((scale * (16 * Math.pow(Math.sin(t), 3))) / 16) *
          Math.sin(v) *
          Math.sin(u) *
          0.8
        const spread = 3.0
        const color = Math.random() > 0.7 ? shapeGreen : shapeWhite
        points.push({
          pos: [
            x + (Math.random() - 0.5) * spread,
            y + (Math.random() - 0.5) * spread,
            z + (Math.random() - 0.5) * spread,
          ],
          col: [color.r, color.g, color.b],
        })
      }
      break

    case 'butterfly':
      for (let i = 0; i < particleCount; i++) {
        const t = (i / particleCount) * Math.PI * 12
        const scale = 5.5
        const exp =
          Math.exp(Math.cos(t)) -
          2 * Math.cos(4 * t) -
          Math.pow(Math.sin(t / 12), 5)
        const x = Math.sin(t) * exp * scale
        const y = Math.cos(t) * exp * scale
        const z = (Math.random() - 0.5) * 15
        const spread = 2.5
        const color = Math.random() > 0.7 ? shapeGreen : shapeWhite
        points.push({
          pos: [
            x + (Math.random() - 0.5) * spread,
            y + (Math.random() - 0.5) * spread,
            z,
          ],
          col: [color.r, color.g, color.b],
        })
      }
      break

    case 'rose':
      for (let i = 0; i < particleCount; i++) {
        const t = (i / particleCount) * Math.PI * 14
        const k = 5
        const r = Math.cos(k * t) * 15
        const h = (Math.random() - 0.5) * 20
        const x = r * Math.cos(t)
        const y = h
        const z = r * Math.sin(t)
        const spread = 2.0
        const color = Math.random() > 0.7 ? shapeGreen : shapeWhite
        points.push({
          pos: [
            x + (Math.random() - 0.5) * spread,
            y,
            z + (Math.random() - 0.5) * spread,
          ],
          col: [color.r, color.g, color.b],
        })
      }
      break

    case 'cube': {
      const cubeSize = 18
      for (let i = 0; i < particleCount; i++) {
        const face = Math.floor(Math.random() * 6)
        let x: number, y: number, z: number
        const a = (Math.random() - 0.5) * cubeSize
        const b = (Math.random() - 0.5) * cubeSize
        switch (face) {
          case 0:
            x = cubeSize / 2
            y = a
            z = b
            break
          case 1:
            x = -cubeSize / 2
            y = a
            z = b
            break
          case 2:
            x = a
            y = cubeSize / 2
            z = b
            break
          case 3:
            x = a
            y = -cubeSize / 2
            z = b
            break
          case 4:
            x = a
            y = b
            z = cubeSize / 2
            break
          default:
            x = a
            y = b
            z = -cubeSize / 2
            break
        }
        const spread = 2.0
        const color = Math.random() > 0.7 ? shapeGreen : shapeWhite
        points.push({
          pos: [
            x + (Math.random() - 0.5) * spread,
            y + (Math.random() - 0.5) * spread,
            z + (Math.random() - 0.5) * spread,
          ],
          col: [color.r, color.g, color.b],
        })
      }
      break
    }

    case 'pyramid': {
      const pyrHeight = 25
      const pyrBase = 20
      for (let i = 0; i < particleCount; i++) {
        const onBase = Math.random() < 0.3
        let x: number, y: number, z: number
        if (onBase) {
          x = (Math.random() - 0.5) * pyrBase
          z = (Math.random() - 0.5) * pyrBase
          y = -pyrHeight / 2
        } else {
          const t = Math.random()
          const baseX = (Math.random() - 0.5) * pyrBase * (1 - t)
          const baseZ = (Math.random() - 0.5) * pyrBase * (1 - t)
          x = baseX
          y = -pyrHeight / 2 + t * pyrHeight
          z = baseZ
        }
        const spread = 2.0
        const color = Math.random() > 0.7 ? shapeGreen : shapeWhite
        points.push({
          pos: [
            x + (Math.random() - 0.5) * spread,
            y + (Math.random() - 0.5) * spread,
            z + (Math.random() - 0.5) * spread,
          ],
          col: [color.r, color.g, color.b],
        })
      }
      break
    }

    case 'spiral':
      for (let i = 0; i < particleCount; i++) {
        const t = (i / particleCount) * Math.PI * 10
        const r = 10 + Math.sin(t * 3) * 4
        const x = r * Math.cos(t)
        const y = (i / particleCount - 0.5) * 40
        const z = r * Math.sin(t)
        const spread = 2.5
        const color = Math.random() > 0.7 ? shapeGreen : shapeWhite
        points.push({
          pos: [
            x + (Math.random() - 0.5) * spread,
            y + (Math.random() - 0.5) * spread,
            z + (Math.random() - 0.5) * spread,
          ],
          col: [color.r, color.g, color.b],
        })
      }
      break

    case 'star':
      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2
        const starPoints = 5
        const innerR = 8
        const outerR = 18
        const pointAngle =
          Math.floor(angle / ((Math.PI * 2) / starPoints)) *
          ((Math.PI * 2) / starPoints)
        const t = (angle - pointAngle) / (Math.PI / starPoints)
        let r: number
        if (t < 1) {
          r = outerR - (outerR - innerR) * t
        } else {
          r = innerR + (outerR - innerR) * (t - 1)
        }
        const x = r * Math.cos(angle)
        const z = r * Math.sin(angle)
        const y = (Math.random() - 0.5) * 15
        const spread = 2.0
        const color = Math.random() > 0.7 ? shapeGreen : shapeWhite
        points.push({
          pos: [
            x + (Math.random() - 0.5) * spread,
            y,
            z + (Math.random() - 0.5) * spread,
          ],
          col: [color.r, color.g, color.b],
        })
      }
      break

    case 'sphere':
      for (let i = 0; i < particleCount; i++) {
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        const r = 16
        const x = r * Math.sin(phi) * Math.cos(theta)
        const y = r * Math.sin(phi) * Math.sin(theta)
        const z = r * Math.cos(phi)
        const spread = 2.5
        const color = Math.random() > 0.7 ? shapeGreen : shapeWhite
        points.push({
          pos: [
            x + (Math.random() - 0.5) * spread,
            y + (Math.random() - 0.5) * spread,
            z + (Math.random() - 0.5) * spread,
          ],
          col: [color.r, color.g, color.b],
        })
      }
      break

    case 'dna':
      for (let i = 0; i < particleCount; i++) {
        const t = (i / particleCount) * Math.PI * 8
        const y = (i / particleCount - 0.5) * 45
        const r = 10
        const strand = i % 3
        let x: number, z: number
        if (strand === 0) {
          x = r * Math.cos(t)
          z = r * Math.sin(t)
        } else if (strand === 1) {
          x = r * Math.cos(t + Math.PI)
          z = r * Math.sin(t + Math.PI)
        } else {
          const barPos = Math.random()
          x =
            r * Math.cos(t) * (1 - barPos) +
            r * Math.cos(t + Math.PI) * barPos
          z =
            r * Math.sin(t) * (1 - barPos) +
            r * Math.sin(t + Math.PI) * barPos
        }
        const spread = 2.0
        const color = Math.random() > 0.7 ? shapeGreen : shapeWhite
        points.push({
          pos: [
            x + (Math.random() - 0.5) * spread,
            y + (Math.random() - 0.5) * spread,
            z + (Math.random() - 0.5) * spread,
          ],
          col: [color.r, color.g, color.b],
        })
      }
      break

    case 'infinity': {
      const infScale = 25
      for (let i = 0; i < particleCount; i++) {
        const t = (i / particleCount) * Math.PI * 6
        const denom = 1 + Math.sin(t) * Math.sin(t)
        const x = (infScale * Math.cos(t)) / denom
        const y = (infScale * Math.sin(t) * Math.cos(t)) / denom
        const verticalSpread = (Math.random() - 0.5) * 20
        const z = (Math.random() - 0.5) * 15 + Math.sin(t * 2) * 5
        const thickness = 4.0
        const offsetX = (Math.random() - 0.5) * thickness
        const offsetY =
          (Math.random() - 0.5) * thickness + verticalSpread * 0.3
        const offsetZ = (Math.random() - 0.5) * thickness
        const color = Math.random() > 0.7 ? shapeGreen : shapeWhite
        points.push({
          pos: [x + offsetX, y + offsetY, z + offsetZ],
          col: [color.r, color.g, color.b],
        })
      }
      break
    }

    default:
      break
  }

  return points
}

const textureDataCache = new Map<string, ImageData | null>()
const MAX_TEXTURE_CACHE_SIZE = 16

/**
 * 纹理图片数据接口（Three.js Texture.image 的最小类型约束）
 */
interface TextureImageLike {
  width: number
  height: number
  src?: string
  id?: string
}

/**
 * 从 Three.js 纹理对象提取像素数据
 */
function getTextureData(texture: THREE.Texture): ImageData | null {
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

/**
 * 场景数据接口
 */
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

/**
 * 粒子动画画布组件
 *
 * 基于 Three.js 的粒子动画系统，支持多种形状、特效和自定义输入源。
 * 形状优先级：modelUrl > imageUrl > shape
 *
 * 用法：
 * ```tsx
 * <ParticleCanvas shape="heart" effect="pulse" />
 * <ParticleCanvas imageUrl="/logo.png" particleSize={300} />
 * <ParticleCanvas modelUrl="/model.glb" interactionEnabled />
 * ```
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

  // 当前 props 的 ref，避免在动画循环中形成闭包陷阱
  const propsRef = useRef({
    shape,
    effect,
    particleSize,
    particleCount,
    imageUrl,
    modelUrl,
    interactionEnabled,
  })

  // 交互状态
  const interactionStateRef = useRef({
    // 相机控制
    target: new THREE.Vector3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    distance: 45,
    minDistance: 20,
    maxDistance: 100,
    isLeftDragging: false,
    isRightDragging: false,
    previousX: 0,
    previousY: 0,
    // 对象拖拽
    isDragging: false,
    objPreviousX: 0,
    objPreviousY: 0,
  })

  // 动画状态
  const animStateRef = useRef({
    time: 0,
    morphFactor: 0,
    effectIntensity: 0,
    targetEffectIntensity: 0,
    explosionTriggered: false,
    explosionTime: 0,
  })
  const destroyedRef = useRef(false)
  const pendingImageRef = useRef<HTMLImageElement | null>(null)

  propsRef.current = {
    shape,
    effect,
    particleSize,
    particleCount,
    imageUrl,
    modelUrl,
    interactionEnabled,
  }

  /**
   * 更新相机位置（交互模式）
   */
  const updateCameraFromState = (camera: THREE.PerspectiveCamera) => {
    const s = interactionStateRef.current
    const cp = Math.cos(s.pitch)
    const sp = Math.sin(s.pitch)
    const cy = Math.cos(s.yaw)
    const sy = Math.sin(s.yaw)
    camera.position.set(
      s.target.x + s.distance * sy * cp,
      s.target.y + s.distance * sp,
      s.target.z + s.distance * cy * cp,
    )
    camera.lookAt(s.target)
  }

  /**
   * 将形状数据写入 targetPosition/targetColor
   */
  const applyShape = (
    sd: SceneData,
    shapePoints: Array<{
      pos: [number, number, number]
      col: [number, number, number]
    }>,
  ) => {
    if (shapePoints.length === 0) return
    const count = sd.targetPositions.length / 3
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      const point = shapePoints[i % shapePoints.length]
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

  /**
   * 处理图片：采样像素生成粒子位置和颜色
   */
  const processImage = (sd: SceneData, url: string) => {
    if (!url) return
    if (pendingImageRef.current) pendingImageRef.current.onload = null
    const img = new Image()
    img.crossOrigin = 'anonymous'
    pendingImageRef.current = img
    img.src = url
    img.onload = () => {
      if (destroyedRef.current) return
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const resolution = 200
      const aspect = img.width / img.height
      const drawWidth = aspect > 1 ? resolution : resolution * aspect
      const drawHeight = aspect > 1 ? resolution / aspect : resolution
      canvas.width = resolution
      canvas.height = resolution
      ctx!.fillStyle = 'black'
      ctx!.fillRect(0, 0, resolution, resolution)
      ctx!.drawImage(
        img,
        (resolution - drawWidth) / 2,
        (resolution - drawHeight) / 2,
        drawWidth,
        drawHeight,
      )
      const imgData = ctx!.getImageData(0, 0, resolution, resolution).data
      const validPoints: Array<{
        pos: number[]
        col: number[]
      }> = []
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const idx = (y * resolution + x) * 4
          const r = imgData[idx],
            g = imgData[idx + 1],
            b = imgData[idx + 2]
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
        const count = sd.targetPositions.length / 3
        for (let i = 0; i < count; i++) {
          const i3 = i * 3
          const point = validPoints[i % validPoints.length]
          sd.targetPositions[i3] = point.pos[0] + (Math.random() - 0.5) * 0.4
          sd.targetPositions[i3 + 1] =
            point.pos[1] + (Math.random() - 0.5) * 0.4
          sd.targetPositions[i3 + 2] =
            point.pos[2] + (Math.random() - 0.5) * 1.5
          sd.targetColors[i3] = point.col[0]
          sd.targetColors[i3 + 1] = point.col[1]
          sd.targetColors[i3 + 2] = point.col[2]
        }
        sd.geometry.attributes.targetPosition.needsUpdate = true
        sd.geometry.attributes.targetColor.needsUpdate = true
      }
    }
  }

  /**
   * 处理 GLTF 模型：采样顶点生成粒子位置和颜色
   */
  const processModel = (sd: SceneData, url: string) => {
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
        const material = Array.isArray(mesh.material)
          ? mesh.material[0]
          : mesh.material
        const texture = (material as THREE.MeshStandardMaterial)?.map
        const imageData = texture ? getTextureData(texture) : null
        const meshColor =
          (material as THREE.MeshStandardMaterial)?.color ??
          new THREE.Color(0xffffff)
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
          const pIndex =
            Math.floor(Math.random() * (positions.length / 3)) * 3
          const jitter = 0.15
          sd.targetPositions[i3] =
            (positions[pIndex] - center.x) * scale +
            (Math.random() - 0.5) * jitter
          sd.targetPositions[i3 + 1] =
            (positions[pIndex + 1] - center.y) * scale +
            (Math.random() - 0.5) * jitter
          sd.targetPositions[i3 + 2] =
            (positions[pIndex + 2] - center.z) * scale +
            (Math.random() - 0.5) * jitter
          sd.targetColors[i3] = colors[pIndex]
          sd.targetColors[i3 + 1] = colors[pIndex + 1]
          sd.targetColors[i3 + 2] = colors[pIndex + 2]
        }
        sd.geometry.attributes.targetPosition.needsUpdate = true
        sd.geometry.attributes.targetColor.needsUpdate = true
      }
    })
  }

  // 初始化 useEffect：创建 Scene/Camera/Renderer/Geometry/Material/Points
  useEffect(() => {
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

    // 默认形状（漩涡）的初始粒子位置
    const greenColor = new THREE.Color(0x00ff66)
    const brightWhite = new THREE.Color(0xffffff)
    for (let i = 0; i < currentParticleCount; i++) {
      const i3 = i * 3
      const t = (Math.random() - 0.5) * 5.0
      const angle = Math.random() * Math.PI * 2
      const radiusBase = 0.4 + Math.pow(Math.abs(t), 2.4)
      const radius = radiusBase * (0.75 + Math.random() * 0.55)
      const x = radius * Math.cos(angle) * 2.9
      const z = radius * Math.sin(angle) * 2.9
      const y = t * 7.5
      positions[i3] = x
      positions[i3 + 1] = y
      positions[i3 + 2] = z
      targetPositions[i3] = x
      targetPositions[i3 + 1] = y
      targetPositions[i3 + 2] = z
      randomOffsets[i3] = (Math.random() - 0.5) * 2
      randomOffsets[i3 + 1] = (Math.random() - 0.5) * 2
      randomOffsets[i3 + 2] = (Math.random() - 0.5) * 2
      const color = Math.random() > 0.7 ? greenColor : brightWhite
      colors[i3] = color.r
      colors[i3 + 1] = color.g
      colors[i3 + 2] = color.b
      targetColors[i3] = color.r
      targetColors[i3 + 1] = color.g
      targetColors[i3 + 2] = color.b
    }

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    )
    geometry.setAttribute(
      'targetPosition',
      new THREE.BufferAttribute(targetPositions, 3),
    )
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute(
      'targetColor',
      new THREE.BufferAttribute(targetColors, 3),
    )
    geometry.setAttribute(
      'randomOffset',
      new THREE.BufferAttribute(randomOffsets, 3),
    )

    
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
      scene,
      camera,
      renderer,
      points,
      geometry,
      material,
      originalPositions: positions.slice(),
      targetPositions,
      originalColors: colors.slice(),
      targetColors,
    }
    sceneDataRef.current = sd

    // 按优先级加载：modelUrl > imageUrl > shape
    const { modelUrl: mUrl, imageUrl: iUrl, shape: s } = propsRef.current
    if (mUrl) {
      processModel(sd, mUrl)
    } else if (iUrl) {
      processImage(sd, iUrl)
    } else if (s && s !== 'default') {
      const shapePoints = generateShapePoints(s, currentParticleCount)
      applyShape(sd, shapePoints)
    }

    
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
      anim.effectIntensity +=
        (anim.targetEffectIntensity - anim.effectIntensity) * 0.08
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
      if (e.button === 0) {
        s.isLeftDragging = true
      } else if (e.button === 2) {
        s.isRightDragging = true
      }
      s.previousX = e.clientX
      s.previousY = e.clientY
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!sceneDataRef.current || !propsRef.current.interactionEnabled)
        return
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
    renderer.domElement.addEventListener('wheel', handleWheel, {
      passive: false,
    })
    renderer.domElement.addEventListener('contextmenu', handleContextMenu)

    
    return () => {
      destroyedRef.current = true
      cancelAnimationFrame(animationIdRef.current)
      if (pendingImageRef.current) pendingImageRef.current.onload = null
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

  // 监听 props 变更并更新场景
  useEffect(() => {
    const sd = sceneDataRef.current
    if (!sd) return

    const { shape: s, effect: e, imageUrl: iUrl, modelUrl: mUrl, particleSize: ps } = propsRef.current
    const count = sd.targetPositions.length / 3

    
    sd.material.uniforms.uPointSize.value = ps

    
    sd.material.uniforms.uEffectMode.value = EFFECT_MODE_MAP[e] ?? 0

    
    if (e === 'explode') {
      animStateRef.current.explosionTriggered = true
      animStateRef.current.targetEffectIntensity = 1
    } else {
      animStateRef.current.explosionTriggered = false
      animStateRef.current.targetEffectIntensity =
        e === 'default' ? 0 : 1
    }

    
    if (mUrl) {
      processModel(sd, mUrl)
    } else if (iUrl) {
      processImage(sd, iUrl)
    } else if (s && s !== 'default') {
      const shapePoints = generateShapePoints(s, count)
      applyShape(sd, shapePoints)
    } else {
      // 恢复默认漩涡形状
      const orig = sd.originalPositions
      const origC = sd.originalColors
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
  }, [shape, effect, particleSize, imageUrl, modelUrl, interactionEnabled])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%', ...style }}
    />
  )
}
