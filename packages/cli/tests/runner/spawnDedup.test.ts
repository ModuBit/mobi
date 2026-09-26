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
 * 唤醒去重查重决策（spec .scratch/wake-dedup 票 01）：spawn 前判定「本机是否已有
 * 活 child 以相同 resume 目标拉起」。表项存在 = 进程存活由 runner exit 清理保证，
 * 本测试只锁决策规则本身。
 */

import { describe, expect, it } from 'vitest'
import { findRunningResumeDuplicate } from '@/runner/spawnDedup'
import type { TrackedSession } from '@/runner/types'

const tracked = (overrides: Partial<TrackedSession> = {}): TrackedSession => ({
  startedBy: 'runner',
  pid: 100,
  ...overrides,
})

describe('findRunningResumeDuplicate', () => {
  it('命中：resume 目标相同的活表项', () => {
    const hit = tracked({ pid: 42, resumeSessionId: 'native-1', MobiSessionId: 'mobi-9' })
    const found = findRunningResumeDuplicate([tracked({ resumeSessionId: 'native-2' }), hit], 'native-1')
    expect(found).toBe(hit)
  })

  it('无命中 / 空集合 → null', () => {
    expect(findRunningResumeDuplicate([], 'native-1')).toBeNull()
    expect(findRunningResumeDuplicate([tracked({ resumeSessionId: 'native-2' })], 'native-1')).toBeNull()
  })

  it('本次 spawn 无 resume 目标（新会话）不查重', () => {
    expect(findRunningResumeDuplicate([tracked({ resumeSessionId: 'native-1' })], undefined)).toBeNull()
    expect(findRunningResumeDuplicate([tracked({ resumeSessionId: 'native-1' })], '')).toBeNull()
  })

  it('表项无 resume 目标（手动 / webhook 注册）不参与比对', () => {
    expect(findRunningResumeDuplicate([tracked({ pid: 7 })], 'native-1')).toBeNull()
  })
})
