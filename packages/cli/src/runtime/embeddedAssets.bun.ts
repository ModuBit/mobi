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

import { feature } from 'bun:bundle';

import difftasticArchiveLicense from '../../tools/archives/difftastic-LICENSE' with { type: 'file' };
import ripgrepArchiveLicense from '../../tools/archives/ripgrep-LICENSE' with { type: 'file' };
import difftasticLicense from '../../tools/licenses/difftastic-LICENSE' with { type: 'file' };
import ripgrepLicense from '../../tools/licenses/ripgrep-LICENSE' with { type: 'file' };

export interface EmbeddedAsset {
    relativePath: string;
    sourcePath: string;
}

function asset(relativePath: string, sourcePath: string): EmbeddedAsset {
    return {
        relativePath,
        sourcePath
    };
}

const COMMON_ASSETS: EmbeddedAsset[] = [
    asset('tools/archives/difftastic-LICENSE', difftasticArchiveLicense),
    asset('tools/archives/ripgrep-LICENSE', ripgrepArchiveLicense),
    asset('tools/licenses/difftastic-LICENSE', difftasticLicense),
    asset('tools/licenses/ripgrep-LICENSE', ripgrepLicense)
];

async function selectEmbeddedAssets(): Promise<EmbeddedAsset[]> {
    if (feature('MOBI_TARGET_DARWIN_ARM64')) {
        const [
            { default: difftasticArm64Darwin },
            { default: ripgrepArm64Darwin }
        ] = await Promise.all([
            import('../../tools/archives/difftastic-arm64-darwin.tar.gz', { with: { type: 'file' } }),
            import('../../tools/archives/ripgrep-arm64-darwin.tar.gz', { with: { type: 'file' } })
        ]);
        return [
            ...COMMON_ASSETS,
            asset('tools/archives/difftastic-arm64-darwin.tar.gz', difftasticArm64Darwin),
            asset('tools/archives/ripgrep-arm64-darwin.tar.gz', ripgrepArm64Darwin)
        ];
    }

    if (feature('MOBI_TARGET_DARWIN_X64')) {
        const [
            { default: difftasticX64Darwin },
            { default: ripgrepX64Darwin }
        ] = await Promise.all([
            import('../../tools/archives/difftastic-x64-darwin.tar.gz', { with: { type: 'file' } }),
            import('../../tools/archives/ripgrep-x64-darwin.tar.gz', { with: { type: 'file' } })
        ]);
        return [
            ...COMMON_ASSETS,
            asset('tools/archives/difftastic-x64-darwin.tar.gz', difftasticX64Darwin),
            asset('tools/archives/ripgrep-x64-darwin.tar.gz', ripgrepX64Darwin)
        ];
    }

    if (feature('MOBI_TARGET_LINUX_ARM64')) {
        const [
            { default: difftasticArm64Linux },
            { default: ripgrepArm64Linux }
        ] = await Promise.all([
            import('../../tools/archives/difftastic-arm64-linux.tar.gz', { with: { type: 'file' } }),
            import('../../tools/archives/ripgrep-arm64-linux.tar.gz', { with: { type: 'file' } })
        ]);
        return [
            ...COMMON_ASSETS,
            asset('tools/archives/difftastic-arm64-linux.tar.gz', difftasticArm64Linux),
            asset('tools/archives/ripgrep-arm64-linux.tar.gz', ripgrepArm64Linux)
        ];
    }

    if (feature('MOBI_TARGET_LINUX_X64')) {
        const [
            { default: difftasticX64Linux },
            { default: ripgrepX64Linux }
        ] = await Promise.all([
            import('../../tools/archives/difftastic-x64-linux.tar.gz', { with: { type: 'file' } }),
            import('../../tools/archives/ripgrep-x64-linux.tar.gz', { with: { type: 'file' } })
        ]);
        return [
            ...COMMON_ASSETS,
            asset('tools/archives/difftastic-x64-linux.tar.gz', difftasticX64Linux),
            asset('tools/archives/ripgrep-x64-linux.tar.gz', ripgrepX64Linux)
        ];
    }

    if (feature('MOBI_TARGET_WIN32_X64')) {
        const [
            { default: difftasticX64Win32 },
            { default: ripgrepX64Win32 }
        ] = await Promise.all([
            import('../../tools/archives/difftastic-x64-win32.tar.gz', { with: { type: 'file' } }),
            import('../../tools/archives/ripgrep-x64-win32.tar.gz', { with: { type: 'file' } })
        ]);
        return [
            ...COMMON_ASSETS,
            asset('tools/archives/difftastic-x64-win32.tar.gz', difftasticX64Win32),
            asset('tools/archives/ripgrep-x64-win32.tar.gz', ripgrepX64Win32)
        ];
    }

    throw new Error('No build target feature flag set. Build with --feature=MOBI_TARGET_*.');
}

export async function loadEmbeddedAssets(): Promise<EmbeddedAsset[]> {
    return selectEmbeddedAssets();
}
