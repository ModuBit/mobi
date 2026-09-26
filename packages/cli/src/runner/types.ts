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
 * Runner-specific types (not related to API/server communication)
 */

import { Metadata } from '@/api/types';
import { ChildProcess } from 'child_process';

/**
 * Session tracking for runner
 */
export interface TrackedSession {
  startedBy: 'runner' | string;
  MobiSessionId?: string;
  MobiSessionMetadataFromLocalWebhook?: Metadata;
  pid: number;
  childProcess?: ChildProcess;
  /** 本 child 的 resume 目标（native session id）。唤醒去重的比对键（.scratch/wake-dedup）：
   *  手动 / webhook 注册的表项拿不到该信息，字段缺省 = 不参与查重 */
  resumeSessionId?: string;
  error?: string;
  directoryCreated?: boolean;
  message?: string;
}