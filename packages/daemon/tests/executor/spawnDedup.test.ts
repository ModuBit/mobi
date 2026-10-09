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
 * 唤醒去重闸（spec .scratch/wake-dedup 票 01 + pending #108 双键扩展）：spawn 前判定
 * 「本机是否已有活 child 属于同一会话」——比对键两个：resume 目标（native session id，
 * 唤醒 spawn 携带）与 mobi 会话行 id（daemon 唤醒/激活路径携带，覆盖 webhook 前在途
 * 窗口与 nativeSessionId 空的回退新会话 spawn）。命中构造 already-running、未命中放行。
 * 表项存在 = 进程存活由 runner exit 清理保证，「清理后放行」用直接删表项模拟；guard
 * 引用 live Map，真实链路里删表项即 child 退出。
 */

import { describe, expect, it } from 'vitest'
import { createSpawnDedupGuard, findRunningDuplicate } from '@/executor/spawnDedup'
import type { TrackedSession } from '@/executor/types'

const tracked = (overrides: Partial<TrackedSession> = {}): TrackedSession => ({
  startedBy: 'runner',
  pid: 100,
  ...overrides,
})

describe('findRunningDuplicate', () => {
  it('命中：resume 目标相同的活表项', () => {
    const hit = tracked({ pid: 42, resumeSessionId: 'native-1', MobiSessionId: 'mobi-9' })
    const found = findRunningDuplicate(
      [tracked({ resumeSessionId: 'native-2' }), hit],
      { resumeSessionId: 'native-1' },
    )
    expect(found).toBe(hit)
  })

  it('命中：mobi 会话行 id 相同的活表项——resume 目标为空也拦（#108 首条消息唤醒竞态：'
     + 'daemon spawn 的在途 child 已由 webhook 盖上 MobiSessionId，唤醒带行 id 必须命中）', () => {
    const inFlight = tracked({ pid: 42, MobiSessionId: 'mobi-9' })
    const found = findRunningDuplicate([inFlight], { mobiSessionId: 'mobi-9' })
    expect(found).toBe(inFlight)
  })

  it('行 id 不同 / 无命中 / 空集合 → null', () => {
    expect(findRunningDuplicate([], { mobiSessionId: 'mobi-9' })).toBeNull()
    expect(
      findRunningDuplicate([tracked({ MobiSessionId: 'mobi-other' })], { mobiSessionId: 'mobi-9' }),
    ).toBeNull()
    expect(
      findRunningDuplicate([tracked({ resumeSessionId: 'native-2' })], { resumeSessionId: 'native-1' }),
    ).toBeNull()
  })

  it('两个键都缺（Web 新会话 spawn，行 id 尚不存在）不查重', () => {
    const children = [tracked({ resumeSessionId: 'native-1', MobiSessionId: 'mobi-9' })]
    expect(findRunningDuplicate(children, {})).toBeNull()
    expect(findRunningDuplicate(children, { resumeSessionId: undefined, mobiSessionId: '' })).toBeNull()
  })

  it('表项无任何键（手动 / webhook 前的裸行）不参与比对', () => {
    expect(findRunningDuplicate([tracked({ pid: 7 })], { resumeSessionId: 'native-1', mobiSessionId: 'mobi-9' })).toBeNull()
  })
})

describe('createSpawnDedupGuard（spawn 入口闸：决策 + already-running 结果构造）', () => {
  it('resume 键命中：返回 already-running（无产物字段），不同目标放行', () => {
    const children = new Map<number, TrackedSession>([
      [42, tracked({ pid: 42, resumeSessionId: 'native-1' })],
    ])
    const guard = createSpawnDedupGuard(children)
    expect(guard({ resumeSessionId: 'native-1' })).toEqual({ type: 'already-running' })
    expect(guard({ resumeSessionId: 'native-2' })).toBeNull()
  })

  it('行 id 键命中：同一 mobi 行的在途 child 拦下第二次 spawn，清理后放行', () => {
    const children = new Map<number, TrackedSession>([
      [42, tracked({ pid: 42, MobiSessionId: 'mobi-9' })],
    ])
    const guard = createSpawnDedupGuard(children)
    expect(guard({ mobiSessionId: 'mobi-9' })).toEqual({ type: 'already-running' })
    children.delete(42)
    expect(guard({ mobiSessionId: 'mobi-9' })).toBeNull()
  })

  it('新会话（无任何键）恒放行', () => {
    const children = new Map<number, TrackedSession>([
      [42, tracked({ pid: 42, resumeSessionId: 'native-1' })],
    ])
    const guard = createSpawnDedupGuard(children)
    expect(guard({})).toBeNull()
    expect(guard({ resumeSessionId: '', mobiSessionId: undefined })).toBeNull()
  })
})
