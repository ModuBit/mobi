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

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const PLATFORMS = [
    {
        name: 'darwin-arm64',
        os: 'darwin',
        cpu: 'arm64',
        buildTarget: 'bun-darwin-arm64',
        binName: 'mobi'
    },
    {
        name: 'darwin-x64',
        os: 'darwin',
        cpu: 'x64',
        buildTarget: 'bun-darwin-x64',
        binName: 'mobi'
    },
    {
        name: 'linux-arm64',
        os: 'linux',
        cpu: 'arm64',
        buildTarget: 'bun-linux-arm64',
        binName: 'mobi'
    },
    {
        name: 'linux-x64',
        os: 'linux',
        cpu: 'x64',
        buildTarget: 'bun-linux-x64-baseline',
        binName: 'mobi'
    },
    {
        name: 'win32-x64',
        os: 'win32',
        cpu: 'x64',
        buildTarget: 'bun-windows-x64',
        binName: 'mobi.exe'
    }
] as const;

interface MainPackageJson {
    name: string;
    version: string;
    description?: string;
    author?: string | { name: string; email?: string; url?: string };
    license?: string;
    type?: string;
    homepage?: string;
    bugs?: string | { url?: string; email?: string };
    repository?: {
        type: string;
        url: string;
        directory?: string;
    };
    bin?: Record<string, string>;
}

async function readMainPackageJson(): Promise<MainPackageJson> {
    const pkgPath = join(projectRoot, 'package.json');
    const content = await Bun.file(pkgPath).text();
    return JSON.parse(content);
}

function generatePlatformPackageJson(
    platform: typeof PLATFORMS[number],
    mainPkg: MainPackageJson
): object {
    return {
        name: `@mobi/cli-${platform.name}`,
        version: mainPkg.version,
        description: `Mobi CLI binary for ${platform.os} ${platform.cpu}`,
        os: [platform.os],
        cpu: [platform.cpu],
        bin: {
            mobi: `bin/${platform.binName}`
        },
        files: [`bin/${platform.binName}`],
        license: mainPkg.license ?? 'Apache-2.0',
        repository: mainPkg.repository
    };
}

function buildOptionalDependencies(version: string): Record<string, string> {
    const optionalDependencies: Record<string, string> = {};

    for (const platform of PLATFORMS) {
        optionalDependencies[`@mobi/cli-${platform.name}`] = version;
    }

    return optionalDependencies;
}

function generateMainPackageJson(
    mainPkg: MainPackageJson,
    optionalDependencies: Record<string, string>
): object {
    return {
        name: mainPkg.name,
        version: mainPkg.version,
        description: mainPkg.description,
        author: mainPkg.author,
        license: mainPkg.license ?? 'Apache-2.0',
        type: mainPkg.type,
        homepage: mainPkg.homepage,
        bugs: mainPkg.bugs,
        repository: mainPkg.repository,
        bin: mainPkg.bin ?? { mobi: 'bin/mobi.cjs' },
        files: ['bin/mobi.cjs'],
        optionalDependencies
    };
}

function prepareMainPackage(
    mainPkg: MainPackageJson,
    projectRoot: string,
    npmDir: string
): void {
    const mainDir = join(npmDir, 'main');
    const binDir = join(mainDir, 'bin');
    const optionalDependencies = buildOptionalDependencies(mainPkg.version);

    mkdirSync(binDir, { recursive: true });

    const srcBin = join(projectRoot, 'bin', 'mobi.cjs');
    const destBin = join(binDir, 'mobi.cjs');
    copyFileSync(srcBin, destBin);
    chmodSync(destBin, 0o755);

    const pkgJson = generateMainPackageJson(mainPkg, optionalDependencies);
    const pkgJsonPath = join(mainDir, 'package.json');
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 4) + '\n');
    console.log(`Generated: ${pkgJsonPath}`);
}

async function preparePlatform(
    platform: typeof PLATFORMS[number],
    mainPkg: MainPackageJson,
    distExeDir: string,
    npmDir: string
): Promise<void> {
    const platformDir = join(npmDir, platform.name);
    const binDir = join(platformDir, 'bin');

    mkdirSync(binDir, { recursive: true });

    const pkgJson = generatePlatformPackageJson(platform, mainPkg);
    const pkgJsonPath = join(platformDir, 'package.json');
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 4) + '\n');
    console.log(`Generated: ${pkgJsonPath}`);

    const srcBin = join(distExeDir, platform.buildTarget, platform.binName);
    const destBin = join(binDir, platform.binName);

    if (!existsSync(srcBin)) {
        throw new Error(`Binary not found: ${srcBin}. Run 'bun run build:exe --all --with-web-assets' first.`);
    }

    copyFileSync(srcBin, destBin);
    console.log(`Copied: ${srcBin} -> ${destBin}`);
}

function updateMainPackageOptionalDeps(version: string): void {
    const pkgPath = join(projectRoot, 'package.json');
    const content = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);

    if (!pkg.optionalDependencies) {
        pkg.optionalDependencies = {};
    }

    pkg.optionalDependencies = buildOptionalDependencies(version);

    writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');
    console.log(`Updated optionalDependencies in package.json to version ${version}`);
}

async function main(): Promise<void> {
    console.log('Preparing npm platform packages...\n');

    const mainPkg = await readMainPackageJson();
    console.log(`Version: ${mainPkg.version}\n`);

    updateMainPackageOptionalDeps(mainPkg.version);

    const distExeDir = join(projectRoot, 'dist-exe');
    const npmDir = join(projectRoot, 'npm');

    // 清理旧的构建产物，避免残留过时的平台包
    rmSync(npmDir, { recursive: true, force: true });

    let hasErrors = false;

    try {
        prepareMainPackage(mainPkg, projectRoot, npmDir);
    } catch (error) {
        console.error('Error preparing main package:', error);
        hasErrors = true;
    }

    for (const platform of PLATFORMS) {
        try {
            await preparePlatform(platform, mainPkg, distExeDir, npmDir);
        } catch (error) {
            console.error(`Error preparing ${platform.name}:`, error);
            hasErrors = true;
        }
    }

    console.log('\nDone!');

    if (hasErrors) {
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
