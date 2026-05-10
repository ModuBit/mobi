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

import type { ParticleEffect } from './types'

/** 特效模式映射 */
export const EFFECT_MODE_MAP: Record<ParticleEffect, number> = {
  default: 0,
  scatter: 1,
  explode: 2,
  vortex: 3,
  pulse: 4,
  wave: 5,
}

/**
 * 顶点着色器
 * 支持 morph 变形、6 种特效模式、粒子大小动画
 */
export const VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uMorph;
uniform float uPointSize;
uniform int uEffectMode;
uniform float uEffectIntensity;
uniform float uExplosionTime;

attribute vec3 targetPosition;
attribute vec3 targetColor;
attribute vec3 color;
attribute vec3 randomOffset;

varying vec3 vColor;
varying float vDistance;

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x_) - 0.5;
  vec3 ox = floor(x_ + 0.5);
  vec3 a0 = x_ - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vColor = mix(color, targetColor, uMorph);
  vec3 pos = mix(position, targetPosition, uMorph);
  vec3 originalPos = pos;
  float effectMix = uEffectIntensity;

  if (uEffectMode == 0) {
    float noise = sin(uTime * 1.5 + position.x * 0.3) * cos(uTime * 1.5 + position.y * 0.3);
    pos += normalize(pos) * noise * (0.2 * (1.0 - uMorph));
    pos.x += sin(uTime * 0.3 + position.z) * 0.1;
    pos.y += cos(uTime * 0.3 + position.x) * 0.1;
  } else if (uEffectMode == 1) {
    vec3 scatterDir = normalize(pos + randomOffset * 0.5);
    float scatterDist = length(pos) * 0.5 + randomOffset.x * 3.0;
    vec3 scattered = pos + scatterDir * scatterDist * effectMix * 2.5;
    float turb = snoise(pos.xy * 0.3 + uTime * 0.5);
    scattered += vec3(turb, turb * 0.5, turb * 0.3) * effectMix * 1.5;
    pos = mix(originalPos, scattered, effectMix);
  } else if (uEffectMode == 2) {
    float explodeProgress = min(uExplosionTime * 2.0, 1.0);
    float returnProgress = max(0.0, (uExplosionTime - 0.5) * 2.0);
    vec3 explodeDir = normalize(pos + randomOffset);
    float explodeDist = (5.0 + randomOffset.x * 8.0) * sin(explodeProgress * 3.14159);
    vec3 exploded = originalPos + explodeDir * explodeDist * effectMix;
    float spin = explodeProgress * 6.28318 * (0.5 + randomOffset.y);
    exploded.x += cos(spin) * explodeDist * 0.3;
    exploded.z += sin(spin) * explodeDist * 0.3;
    pos = mix(originalPos, exploded, effectMix * (1.0 - returnProgress * 0.7));
  } else if (uEffectMode == 3) {
    float angle = atan(pos.z, pos.x);
    float radius = length(pos.xz);
    float height = pos.y;
    float spiralSpeed = uTime * 2.0 + height * 0.3;
    float newAngle = angle + spiralSpeed * effectMix;
    float vortexPull = (1.0 - abs(height) / 20.0) * effectMix;
    float newRadius = radius * (1.0 - vortexPull * 0.5) + sin(uTime * 3.0 + height) * effectMix;
    float lift = effectMix * 5.0 * (1.0 - radius / 20.0);
    pos.x = cos(newAngle) * newRadius;
    pos.z = sin(newAngle) * newRadius;
    pos.y = height + lift * sin(uTime + radius);
  } else if (uEffectMode == 4) {
    float pulsePhase = uTime * 2.5;
    float pulseFactor = 1.0 + sin(pulsePhase) * 0.4 * effectMix;
    float waveFactor = sin(pulsePhase + length(pos) * 0.3) * 0.3 * effectMix;
    vec3 pulsed = pos * pulseFactor;
    pulsed += normalize(pos) * waveFactor * 3.0;
    float colorPulse = sin(pulsePhase * 0.5) * 0.5 + 0.5;
    vColor = mix(vColor, vec3(1.0, 0.4, 0.8), colorPulse * effectMix * 0.3);
    pos = pulsed;
  } else if (uEffectMode == 5) {
    float waveX = sin(pos.x * 0.5 + uTime * 2.0) * effectMix * 3.0;
    float waveZ = cos(pos.z * 0.5 + uTime * 1.5) * effectMix * 2.0;
    float waveY = sin(pos.x * 0.3 + pos.z * 0.3 + uTime * 2.5) * effectMix * 4.0;
    waveY += sin(pos.x * 0.8 - uTime * 1.8) * effectMix * 1.5;
    waveY += cos(pos.z * 0.6 + uTime * 1.2) * effectMix * 1.0;
    pos.x += waveX * 0.3;
    pos.y += waveY;
    pos.z += waveZ * 0.3;
  }

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float dist = length(pos);
  vDistance = dist;

  float sizeMultiplier = 1.0;
  if (uEffectMode == 2 && effectMix > 0.1) sizeMultiplier = 1.0 + sin(uExplosionTime * 10.0) * 0.3;
  if (uEffectMode == 4) sizeMultiplier = 1.0 + sin(uTime * 2.5) * 0.2 * effectMix;

  gl_PointSize = (uPointSize / -mvPosition.z) * (1.2 + sin(uTime * 3.0 + dist * 0.15) * 0.5) * sizeMultiplier;
  gl_Position = projectionMatrix * mvPosition;
}
`

/**
 * 片段着色器
 * 圆形粒子 + 距离衰减 + 颜色呼吸
 */
export const FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
varying vec3 vColor;
varying float vDistance;

void main() {
  float dist = distance(gl_PointCoord, vec2(0.5));
  if (dist > 0.5) discard;

  float strength = pow(1.0 - dist * 2.0, 1.6);
  vec3 finalColor = vColor * 2.0;
  float alpha = strength * (0.8 + sin(vDistance * 0.3 + uTime) * 0.2);
  gl_FragColor = vec4(finalColor, alpha);
}
`
