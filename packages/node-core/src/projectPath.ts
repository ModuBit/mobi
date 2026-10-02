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

import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { configuration } from './configuration';
// 语义锚定：projectPath/configuration 的「安装根」与版本号指 mobi CLI 包
// （bundledPlugins / runtime 资产 / 版本检查都以 cli 包为安装主体），
// 本模块搬入 node-core 后须跨包锚定回 cli（workspace 源码布局稳定：packages/node-core/src → ../../cli）
import packageJson from '../../cli/package.json';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Bun embeds compiled code in a virtual filesystem: /$bunfs/ (Linux/macOS) or /~BUN/ (Windows) */
const bunMain = globalThis.Bun?.main ?? '';
const isCompiled = bunMain.includes('$bunfs') || bunMain.includes('/~BUN/');

export function projectPath(): string {
    return resolve(__dirname, '../../cli');
}

export function runtimePath(): string {
    if (!isCompiled) {
        return projectPath();
    }

    return join(configuration.mobiHomeDir, 'runtime', packageJson.version);
}

export function isBunCompiled(): boolean {
    return isCompiled;
}
