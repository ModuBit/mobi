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
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { configuration } from '@/configuration'
import { getMobiCliCommand } from '@/utils/spawnMobiCli'
import { isBunCompiled } from '@/projectPath'
import { askYesNo } from './prompts'

// macOS launchd
const LAUNCHD_LABEL = 'com.modu.mobi'
const LAUNCHD_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)

// Linux systemd
const SYSTEMD_UNIT_NAME = 'mobi.service'
const SYSTEMD_UNIT_DIR = join(homedir(), '.config', 'systemd', 'user')
const SYSTEMD_UNIT_PATH = join(SYSTEMD_UNIT_DIR, SYSTEMD_UNIT_NAME)

// Wrapper 脚本
const WRAPPER_SCRIPT = join(configuration.mobiHomeDir, 'mobi-service.sh')

/**
 * 获取 mobi 命令的完整路径字符串（用于 wrapper 脚本）
 */
function getMobiBinPath(): string {
    const cmd = getMobiCliCommand([])
    if (cmd.args.length > 0) {
        // 开发模式: bun /path/to/entrypoint
        return `${cmd.command} ${cmd.args[0]}`
    }
    return cmd.command
}

/**
 * 生成 wrapper 脚本内容
 */
function generateWrapperScript(host: string, port: number): string {
    const mobiBin = getMobiBinPath()

    return `#!/bin/bash
# Mobi service wrapper - starts hub then runner
set -e

# Start hub in background
${mobiBin} hub start-sync --host ${host} --port ${port} &
HUB_PID=$!

# Wait for hub to be healthy
MAX_WAIT=30
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -sf http://${host}:${port}/health > /dev/null 2>&1; then
        break
    fi
    sleep 1
    WAITED=$((WAITED + 1))
done

# Start runner in foreground (service tracks this PID)
exec ${mobiBin} runner start-sync
`
}

/**
 * 生成 macOS launchd plist
 */
function generateLaunchdPlist(_host: string, _port: number): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${WRAPPER_SCRIPT}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${join(configuration.logsDir, 'hub-stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${join(configuration.logsDir, 'hub-stderr.log')}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}</string>
    </dict>
</dict>
</plist>
`
}

/**
 * 生成 Linux systemd unit
 */
function generateSystemdUnit(): string {
    return `[Unit]
Description=Mobi Hub and Runner Service
After=network.target

[Service]
Type=simple
ExecStart=${WRAPPER_SCRIPT}
Restart=on-failure
RestartSec=5
Environment=PATH=${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}

[Install]
WantedBy=default.target
`
}

/**
 * 安装系统服务
 */
export async function installService(host: string, port: number): Promise<void> {
    const platform = process.platform

    if (platform !== 'darwin' && platform !== 'linux') {
        console.log(chalk.yellow('System service is not supported on this platform yet'))
        console.log(chalk.gray('  Use "mobi hub start" and "mobi runner start" instead'))
        return
    }

    // 非 TTY 提示
    if (!process.stdin.isTTY) {
        console.log(chalk.yellow('Service install requires an interactive terminal'))
        process.exit(1)
    }

    // dev 模式警告
    if (!isBunCompiled()) {
        console.log(chalk.yellow('Warning: Running in development mode'))
        console.log(chalk.gray('  The service will use the dev runtime, which may not work as expected'))
        const shouldContinue = await askYesNo('Continue anyway?')
        if (!shouldContinue) return
    }

    // 检查是否已安装
    const configPath = platform === 'darwin' ? LAUNCHD_PLIST : SYSTEMD_UNIT_PATH
    if (existsSync(configPath)) {
        console.log(chalk.yellow('Service is already installed'))
        const shouldReinstall = await askYesNo('Reinstall?')
        if (!shouldReinstall) return

        // 先移除旧的
        await removeService()
    }

    // 生成 wrapper 脚本
    writeFileSync(WRAPPER_SCRIPT, generateWrapperScript(host, port), { mode: 0o755 })
    console.log(chalk.gray(`  Wrapper script: ${WRAPPER_SCRIPT}`))

    if (platform === 'darwin') {
        installLaunchd(host, port)
    } else {
        installSystemd()
    }
}

function installLaunchd(host: string, port: number): void {
    // 确保 LaunchAgents 目录存在
    const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents')
    if (!existsSync(launchAgentsDir)) {
        mkdirSync(launchAgentsDir, { recursive: true })
    }

    // 写入 plist
    writeFileSync(LAUNCHD_PLIST, generateLaunchdPlist(host, port))
    console.log(chalk.gray(`  Plist: ${LAUNCHD_PLIST}`))

    // 加载并启动
    execSync(`launchctl load ${LAUNCHD_PLIST}`, { stdio: 'pipe' })
    console.log(chalk.green('Service installed and started (launchd)'))
    console.log(chalk.gray('  Logs: ~/.mobi/logs/hub-stdout.log'))
}

function installSystemd(): void {
    // 确保 unit 目录存在
    if (!existsSync(SYSTEMD_UNIT_DIR)) {
        mkdirSync(SYSTEMD_UNIT_DIR, { recursive: true })
    }

    // 写入 unit 文件
    writeFileSync(SYSTEMD_UNIT_PATH, generateSystemdUnit())
    console.log(chalk.gray(`  Unit: ${SYSTEMD_UNIT_PATH}`))

    // reload + enable + start
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' })
    execSync(`systemctl --user enable ${SYSTEMD_UNIT_NAME}`, { stdio: 'pipe' })
    execSync(`systemctl --user start ${SYSTEMD_UNIT_NAME}`, { stdio: 'pipe' })

    // enable-linger 确保无活跃会话时服务也运行
    try {
        execSync('loginctl enable-linger', { stdio: 'pipe' })
    } catch {
        console.log(chalk.gray('  Note: loginctl enable-linger failed, service may stop when you log out'))
    }

    console.log(chalk.green('Service installed and started (systemd)'))
    console.log(chalk.gray('  Logs: journalctl --user -u mobi.service'))
}

/**
 * 移除系统服务
 */
export async function removeService(): Promise<void> {
    const platform = process.platform

    if (platform === 'darwin') {
        removeLaunchd()
    } else if (platform === 'linux') {
        removeSystemd()
    } else {
        console.log(chalk.yellow('System service is not supported on this platform'))
        return
    }

    // 删除 wrapper 脚本
    if (existsSync(WRAPPER_SCRIPT)) {
        rmSync(WRAPPER_SCRIPT)
        console.log(chalk.gray('  Wrapper script removed'))
    }
}

function removeLaunchd(): void {
    if (!existsSync(LAUNCHD_PLIST)) {
        console.log(chalk.yellow('Service is not installed'))
        return
    }

    // 卸载
    try {
        execSync(`launchctl unload ${LAUNCHD_PLIST}`, { stdio: 'pipe' })
    } catch {
        // 可能已经没有加载
    }

    rmSync(LAUNCHD_PLIST)
    console.log(chalk.green('Service removed (launchd)'))
}

function removeSystemd(): void {
    if (!existsSync(SYSTEMD_UNIT_PATH)) {
        console.log(chalk.yellow('Service is not installed'))
        return
    }

    try {
        execSync(`systemctl --user stop ${SYSTEMD_UNIT_NAME}`, { stdio: 'pipe' })
    } catch {
        // 可能已经停止
    }

    try {
        execSync(`systemctl --user disable ${SYSTEMD_UNIT_NAME}`, { stdio: 'pipe' })
    } catch {
        // 可能已经禁用
    }

    rmSync(SYSTEMD_UNIT_PATH)

    try {
        execSync('systemctl --user daemon-reload', { stdio: 'pipe' })
    } catch {
        // ignore
    }

    console.log(chalk.green('Service removed (systemd)'))
}

/**
 * 查看服务状态
 */
export async function serviceStatus(): Promise<void> {
    const platform = process.platform

    console.log(chalk.bold('Service Status'))
    console.log('')

    // 检查配置文件
    const configPath = platform === 'darwin' ? LAUNCHD_PLIST
        : platform === 'linux' ? SYSTEMD_UNIT_PATH
            : null

    if (configPath) {
        const installed = existsSync(configPath)
        console.log(`  Config:     ${installed ? chalk.green('installed') : chalk.gray('not installed')}`)
        if (installed) {
            console.log(`  Path:       ${chalk.gray(configPath)}`)
        }
    } else {
        console.log(`  Platform:   ${chalk.yellow('not supported for service management')}`)
    }

    // 检查 wrapper 脚本
    const wrapperExists = existsSync(WRAPPER_SCRIPT)
    console.log(`  Wrapper:    ${wrapperExists ? chalk.green('exists') : chalk.gray('not found')}`)

    // 检查服务加载状态
    if (platform === 'darwin' && existsSync(LAUNCHD_PLIST)) {
        try {
            const output = execSync(`launchctl list ${LAUNCHD_LABEL}`, { stdio: 'pipe', encoding: 'utf-8' })
            const pidMatch = output.match(/"PID" = (\d+)/)
            if (pidMatch) {
                console.log(`  Service:    ${chalk.green(`running (PID ${pidMatch[1]})`)}`)
            } else {
                console.log(`  Service:    ${chalk.yellow('loaded but not running')}`)
            }
        } catch {
            console.log(`  Service:    ${chalk.yellow('not loaded')}`)
        }
    } else if (platform === 'linux' && existsSync(SYSTEMD_UNIT_PATH)) {
        try {
            execSync(`systemctl --user is-active ${SYSTEMD_UNIT_NAME}`, { stdio: 'pipe' })
            console.log(`  Service:    ${chalk.green('active')}`)
        } catch {
            console.log(`  Service:    ${chalk.yellow('inactive')}`)
        }
    }
}
