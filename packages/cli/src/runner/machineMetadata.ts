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
 * 机器身份元数据构造（runner 侧）：machine 注册时上报的静态身份。
 * 从 agent/sessionFactory 拆出——daemon（runner）与 session（终端游离会话）
 * 都要注册 machine，但构造逻辑是宿主能力，随 11 票与 getEnvironmentInfo/
 * machineId 读取一起归 node-core。
 */

import os from 'node:os'

import type { MachineMetadata } from '@mobi/shared/hostProtocol'
import { configuration } from '@mobi/node-core/configuration'
import { runtimePath } from '@mobi/node-core/projectPath'
import packageJson from '../../package.json'

export function buildMachineMetadata(): MachineMetadata {
    return {
        host: process.env.MOBI_HOSTNAME || os.hostname(),
        platform: os.platform(),
        mobiCliVersion: packageJson.version,
        homeDir: os.homedir(),
        mobiHomeDir: configuration.mobiHomeDir,
        mobiLibDir: runtimePath()
    }
}
