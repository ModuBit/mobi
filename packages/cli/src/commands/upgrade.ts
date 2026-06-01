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
import { accessSync, constants } from 'node:fs'
import { dirname } from 'node:path'
import packageJson from '../../package.json'
import { readSettings, updateSettings } from '@/persistence'
import { getPlatformAssetName, type Channel } from '@/upgrader/constants'
import { fetchLatestRelease, fetchReleaseByTag, isNewerVersion, type GitHubRelease } from '@/upgrader/checker'
import { downloadBinary, downloadChecksums, verifyChecksum, extractBinaryFromZip } from '@/upgrader/downloader'
import { replaceBinary } from '@/upgrader/replacer'
import { detectActiveProcesses, restartProcesses, formatActiveProcessesPrompt, hasActiveProcesses } from '@/upgrader/processRestarter'
import { askYesNo } from '@/setup/prompts'
import type { CommandContext, CommandDefinition } from './types'

function parseUpgradeArgs(args: string[]): {
    targetVersion?: string
    channel?: Channel
    yes?: boolean
} {
    let targetVersion: string | undefined
    let channel: Channel | undefined
    let yes: boolean | undefined

    for (const arg of args) {
        if (arg === '--rc') {
            channel = 'rc'
        } else if (arg === '--yes' || arg === '-y') {
            yes = true
        } else if (arg.startsWith('v')) {
            targetVersion = arg
        }
    }

    return { targetVersion, channel, yes }
}

async function runUpgrade(context: CommandContext): Promise<void> {
    if (context.commandArgs.includes('-h') || context.commandArgs.includes('--help')) {
        console.log(`
${chalk.bold('mobi upgrade')} - Upgrade to latest version

${chalk.bold('Usage:')}
  mobi upgrade              Upgrade to latest stable version
  mobi upgrade --rc         Upgrade to latest rc version
  mobi upgrade v0.2.0       Upgrade to a specific version
  mobi upgrade --yes        Skip confirmation prompts
`)
        return
    }

    const { targetVersion, channel: channelFlag, yes: autoYes } = parseUpgradeArgs(context.commandArgs)

    // 检测当前二进制路径
    const currentBinary = process.execPath

    // 检测目标目录是否可写（renameSync 需要目录写权限）
    const targetDir = dirname(currentBinary)
    try {
        accessSync(targetDir, constants.W_OK)
    } catch {
        console.error(chalk.red('Cannot write to the binary directory:'))
        console.error(chalk.gray(`  ${targetDir}`))
        console.error(chalk.gray('Try running with sudo or move mobi to a writable directory.'))
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

    const isDowngrade = !isNewerVersion(currentVersion, targetTag)
    if (isDowngrade) {
        console.log(chalk.yellow(`Warning: ${targetTag} is older than current ${currentVersion}`))
        const shouldContinue = autoYes || await askYesNo('Continue with downgrade?')
        if (!shouldContinue) {
            console.log(chalk.gray('Upgrade cancelled'))
            return
        }
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
        const shouldRestart = autoYes || await askYesNo(prompt)
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
