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

import chalk from 'chalk'
import { createInterface } from 'node:readline'
import packageJson from '../../package.json'
import { readSettings, updateSettings } from '@/persistence'
import { getPlatformAssetName, INSTALL_DIR, type Channel } from '@/upgrader/constants'
import { fetchLatestRelease, fetchReleaseByTag, type GitHubRelease } from '@/upgrader/checker'
import { downloadBinary, downloadChecksums, verifyChecksum, extractBinaryFromZip } from '@/upgrader/downloader'
import { replaceBinary, isInstalledViaInstallScript } from '@/upgrader/replacer'
import { detectActiveProcesses, restartProcesses, formatActiveProcessesPrompt, hasActiveProcesses } from '@/upgrader/processRestarter'
import type { CommandContext, CommandDefinition } from './types'

function askYesNo(question: string): Promise<boolean> {
    return new Promise((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        })
        rl.question(`${question} [Y/n] `, (answer) => {
            rl.close()
            const normalized = answer.trim().toLowerCase()
            resolve(normalized === '' || normalized === 'y' || normalized === 'yes')
        })
    })
}

function parseUpgradeArgs(args: string[]): {
    targetVersion?: string
    channel?: Channel
} {
    let targetVersion: string | undefined
    let channel: Channel | undefined

    for (const arg of args) {
        if (arg === '--rc') {
            channel = 'rc'
        } else if (arg.startsWith('v')) {
            targetVersion = arg
        }
    }

    return { targetVersion, channel }
}

async function runUpgrade(context: CommandContext): Promise<void> {
    const { targetVersion, channel: channelFlag } = parseUpgradeArgs(context.commandArgs)

    // 检测安装路径
    const currentBinary = process.execPath
    if (!isInstalledViaInstallScript(currentBinary)) {
        console.error(chalk.yellow(
            `Mobi was not installed via the install script (expected in ${INSTALL_DIR}).`
        ))
        console.error(chalk.gray(
            'Please download the latest version manually from https://github.com/modu/mobi/releases'
        ))
        process.exit(1)
    }

    // 确定目标 channel
    const settings = await readSettings()
    const currentChannel = settings.updateChannel ?? 'stable'
    const targetChannel = channelFlag ?? currentChannel

    // 获取目标 release
    let targetRelease: GitHubRelease | null

    if (targetVersion) {
        console.log(chalk.gray(`Looking up version ${targetVersion}...`))
        targetRelease = await fetchReleaseByTag(targetVersion)
        if (!targetRelease) {
            console.error(chalk.red(`Version ${targetVersion} not found`))
            process.exit(1)
        }
    } else {
        console.log(chalk.gray(`Checking for updates (${targetChannel})...`))
        targetRelease = await fetchLatestRelease(targetChannel)
        if (!targetRelease) {
            console.error(chalk.red(`No ${targetChannel} release found`))
            process.exit(1)
        }
    }

    const currentVersion = `v${packageJson.version}`
    const targetTag = targetRelease.tag_name

    // 比较版本
    if (targetTag === currentVersion) {
        console.log(chalk.green(`Already up to date (${currentVersion})`))
        return
    }

    console.log(`Upgrading ${chalk.cyan(currentVersion)} → ${chalk.cyan(targetTag)}`)

    // 查找平台对应的 asset
    const platformAssetName = getPlatformAssetName()
    const platformAsset = targetRelease.assets.find(a => a.name === platformAssetName)
    if (!platformAsset) {
        console.error(chalk.red(`No binary found for your platform (${platformAssetName})`))
        process.exit(1)
    }

    // 下载 checksums
    console.log(chalk.gray('Downloading checksums...'))
    const checksumsContent = await downloadChecksums(targetRelease.assets)

    // 下载二进制
    console.log(chalk.gray(`Downloading ${platformAsset.name}...`))
    const downloadedPath = await downloadBinary(platformAsset)

    // 校验
    console.log(chalk.gray('Verifying checksum...'))
    if (!verifyChecksum(downloadedPath, platformAsset.name, checksumsContent)) {
        console.error(chalk.red('Checksum verification failed! The downloaded file may be corrupted.'))
        process.exit(1)
    }

    // 解压
    console.log(chalk.gray('Extracting binary...'))
    const binaryPath = extractBinaryFromZip(downloadedPath)

    // 原子替换
    console.log(chalk.gray('Replacing binary...'))
    replaceBinary(binaryPath, currentBinary)

    // 更新 channel 设置
    if (channelFlag && channelFlag !== currentChannel) {
        await updateSettings(s => ({ ...s, updateChannel: channelFlag }))
        console.log(chalk.gray(`Switched to ${channelFlag} channel`))
    }

    console.log(chalk.green(`Upgraded mobi ${currentVersion} → ${targetTag}`))

    // 检测活跃进程
    const processes = await detectActiveProcesses()
    if (hasActiveProcesses(processes)) {
        const prompt = formatActiveProcessesPrompt(processes)
        const shouldRestart = await askYesNo(prompt)
        if (shouldRestart) {
            await restartProcesses()
        } else {
            console.log(chalk.gray('Restart later: mobi hub restart && mobi runner restart'))
        }
    }
}

export const upgradeCommand: CommandDefinition = {
    name: 'upgrade',
    requiresRuntimeAssets: false,
    run: runUpgrade,
}
