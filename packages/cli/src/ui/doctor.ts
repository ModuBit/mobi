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
 * Doctor command implementation
 * 
 * Provides comprehensive diagnostics and troubleshooting information
 * for mobi CLI including configuration, runner status, logs, and links
 */

import chalk from 'chalk'
import { spawn } from 'node:child_process'
import { configuration } from '@/configuration'
import { readSettings, readHubSettings } from '@/persistence'
import { checkIfRunnerRunningAndCleanupStaleState } from '@/runner/controlClient'
import { findAllMobiProcesses } from '@/runner/doctor'
import { readRunnerState } from '@/persistence'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isBunCompiled, projectPath, runtimePath } from '@/projectPath'
import { getClaudeExecutablePath } from '@/claude/sdk/claudeExecutable'
import { withBunRuntimeEnv } from '@/utils/bunRuntime'
import packageJson from '../../package.json'

/**
 * Get relevant environment information for debugging
 */
export function getEnvironmentInfo(): Record<string, string | number | boolean | string[] | undefined> {
    return {
        PWD: process.env.PWD,
        MOBI_HOME: process.env.MOBI_HOME,
        MOBI_API_URL: process.env.MOBI_API_URL,
        MOBI_PROJECT_ROOT: process.env.MOBI_PROJECT_ROOT,
        CLI_API_TOKEN_SET: Boolean(process.env.CLI_API_TOKEN),
        DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING: process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING,
        NODE_ENV: process.env.NODE_ENV,
        DEBUG: process.env.DEBUG,
        workingDirectory: process.cwd(),
        processArgv: process.argv,
        mobiHomeDir: configuration?.mobiHomeDir,
        apiUrl: configuration?.apiUrl,
        logsDir: configuration?.logsDir,
        processPid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        user: process.env.USER,
        home: process.env.HOME,
        shell: process.env.SHELL,
        terminal: process.env.TERM,
    };
}

function getLogFiles(logDir: string): { file: string, path: string, modified: Date }[] {
    if (!existsSync(logDir)) {
        return [];
    }

    try {
        return readdirSync(logDir)
            .filter(file => file.endsWith('.log'))
            .map(file => {
                const path = join(logDir, file);
                const stats = statSync(path);
                return { file, path, modified: stats.mtime };
            })
            .sort((a, b) => b.modified.getTime() - a.modified.getTime());
    } catch {
        return [];
    }
}

/**
 * Run doctor command specifically for runner diagnostics
 */
export async function runDoctorRunner(): Promise<void> {
    return runDoctorCommand('runner');
}

export async function runDoctorCommand(filter?: 'all' | 'runner' | string): Promise<void> {
    // Default to 'all' if no filter specified
    if (!filter) {
        filter = 'all';
    }
    
    console.log(`\n${chalk.bold.cyan('🩺 mobi CLI Doctor')} ${chalk.bold(filter)}\n`);

    // For 'all' filter, show everything. For 'runner', only show runner-related info
    if (filter === 'all') {
        // Version and basic info
        console.log(chalk.bold('📋 Basic Information'));
        console.log(`mobi CLI Version: ${chalk.green(packageJson.version)}`);
        console.log(`Platform: ${chalk.green(process.platform)} ${process.arch}`);
        console.log(`Node.js Version: ${chalk.green(process.version)}`);
        console.log('');

        // Runner spawn diagnostics
        console.log(chalk.bold('🔧 Runner Spawn Diagnostics'));
        const projectRoot = projectPath();
        const cliEntrypoint = join(projectRoot, 'src', 'index.ts');

        if (isBunCompiled()) {
            console.log(`Executable: ${chalk.blue(process.execPath)}`);
            console.log(`Runtime Assets: ${chalk.blue(runtimePath())}`);
        } else {
            console.log(`Project Root: ${chalk.blue(projectRoot)}`);
            console.log(`CLI Entrypoint: ${chalk.blue(cliEntrypoint)}`);
            console.log(`CLI Exists: ${existsSync(cliEntrypoint) ? chalk.green('✓ Yes') : chalk.red('❌ No')}`);
        }
        console.log('');

        // Configuration
        console.log(chalk.bold('⚙️  Configuration'));
        console.log(`mobi Home: ${chalk.blue(configuration.mobiHomeDir)}`);
        console.log(`Bot URL: ${chalk.blue(configuration.apiUrl)}`);
        console.log(`Logs Dir: ${chalk.blue(configuration.logsDir)}`);

        // Environment
        console.log(chalk.bold('\n🌍 Environment Variables'));
        const env = getEnvironmentInfo();
        console.log(`MOBI_HOME: ${env.MOBI_HOME ? chalk.green(env.MOBI_HOME) : chalk.gray('not set')}`);
        console.log(`MOBI_API_URL: ${env.MOBI_API_URL ? chalk.green(env.MOBI_API_URL) : chalk.gray('not set')}`);
        console.log(`CLI_API_TOKEN: ${env.CLI_API_TOKEN_SET ? chalk.green('set') : chalk.gray('not set')}`);
        console.log(`DANGEROUSLY_LOG_TO_SERVER: ${env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING ? chalk.yellow('ENABLED') : chalk.gray('not set')}`);
        console.log(`DEBUG: ${env.DEBUG ? chalk.green(env.DEBUG) : chalk.gray('not set')}`);
        console.log(`NODE_ENV: ${env.NODE_ENV ? chalk.green(env.NODE_ENV) : chalk.gray('not set')}`);

        // Settings（cli 与 hub 分文件展示：hub 与 cli 可不同机器部署，
        // 本机读不到 hub 文件时提示远端而非报错）
        let settings;
        try {
            settings = await readSettings();
            console.log(chalk.bold('\n📄 CLI Settings (settings.cli.json):'));
            // Hide cliApiToken in output for security
            const displaySettings = { ...settings, cliApiToken: settings.cliApiToken ? '***' : undefined };
            console.log(chalk.gray(JSON.stringify(displaySettings, null, 2)));
        } catch (_error) {
            console.log(chalk.bold('\n📄 CLI Settings:'));
            console.log(chalk.red('❌ Failed to read settings'));
            settings = {};
        }
        try {
            const hubSettings = await readHubSettings();
            console.log(chalk.bold('\n📄 Hub Settings (settings.hub.json):'));
            if (Object.keys(hubSettings).length === 0 && !existsSync(configuration.hubSettingsFile)) {
                // 非 co-located 部署：hub 文件不在本机是正常形态，不是故障
                console.log(chalk.gray(`Not found locally (${configuration.hubSettingsFile}) — hub may be deployed on a remote machine.`));
            } else {
                console.log(chalk.gray(JSON.stringify(hubSettings, null, 2)));
            }
        } catch (_error) {
            console.log(chalk.bold('\n📄 Hub Settings:'));
            console.log(chalk.red('❌ Failed to read hub settings'));
        }
        // Authentication status (direct-connect)
        console.log(chalk.bold('\n🔐 Direct Connect Auth'));
        const envToken = process.env.CLI_API_TOKEN;
        const settingsToken = settings.cliApiToken;
        const hasToken = Boolean(envToken || settingsToken);
        const tokenSource = envToken ? 'environment variable' : (settingsToken ? 'settings file' : 'none');
        if (hasToken) {
            console.log(chalk.green(`✓ CLI_API_TOKEN is set (from ${tokenSource})`));
        } else {
            console.log(chalk.red('❌ CLI_API_TOKEN is not set'));
            console.log(chalk.gray('  Run `mobi auth login` to configure or set CLI_API_TOKEN env var'));
        }

    }

    // Runner status - shown for both 'all' and 'runner' filters
    console.log(chalk.bold('\n🤖 Runner Status'));
    try {
        const isRunning = await checkIfRunnerRunningAndCleanupStaleState();
        const state = await readRunnerState();

        if (isRunning && state) {
            console.log(chalk.green('✓ Runner is running'));
            console.log(`  PID: ${state.pid}`);
            console.log(`  Started: ${new Date(state.startTime).toLocaleString()}`);
            console.log(`  CLI Version: ${state.startedWithCliVersion}`);
            if (state.httpPort) {
                console.log(`  HTTP Port: ${state.httpPort}`);
            }
        } else if (state && !isRunning) {
            console.log(chalk.yellow('⚠️  Runner state exists but process not running (stale)'));
        } else {
            console.log(chalk.red('❌ Runner is not running'));
        }

        // Show runner state file
        if (state) {
            console.log(chalk.bold('\n📄 Runner State:'));
            console.log(chalk.blue(`Location: ${configuration.runnerStateFile}`));
            console.log(chalk.gray(JSON.stringify(state, null, 2)));
        }

        // All mobi processes
        const allProcesses = await findAllMobiProcesses();
        if (allProcesses.length > 0) {
            console.log(chalk.bold('\n🔍 All mobi CLI Processes'));

            // Group by type
            const grouped = allProcesses.reduce((groups, process) => {
                if (!groups[process.type]) groups[process.type] = [];
                groups[process.type].push(process);
                return groups;
            }, {} as Record<string, typeof allProcesses>);

            // Display each group
            Object.entries(grouped).forEach(([type, processes]) => {
                const typeLabels: Record<string, string> = {
                    'current': '📍 Current Process',
                    'runner': '🤖 Runner',
                    'runner-version-check': '🔍 Runner Version Check (stuck)',
                    'runner-spawned-session': '🔗 Runner-Spawned Sessions',
                    'user-session': '👤 User Sessions',
                    'dev-runner': '🛠️  Dev Runner',
                    'dev-runner-version-check': '🛠️  Dev Runner Version Check (stuck)',
                    'dev-session': '🛠️  Dev Sessions',
                    'dev-doctor': '🛠️  Dev Doctor',
                    'dev-related': '🛠️  Dev Related',
                    'doctor': '🩺 Doctor',
                    'unknown': '❓ Unknown'
                };

                console.log(chalk.blue(`\n${typeLabels[type] || type}:`));
                processes.forEach(({ pid, command }) => {
                    const color = type === 'current' ? chalk.green :
                        type.startsWith('dev') ? chalk.cyan :
                            type.includes('runner') ? chalk.blue : chalk.gray;
                    console.log(`  ${color(`PID ${pid}`)}: ${chalk.gray(command)}`);
                });
            });
        } else {
            console.log(chalk.red('❌ No mobi processes found'));
        }

        if (filter === 'all' && allProcesses.length > 1) { // More than just current process
            console.log(chalk.bold('\n💡 Process Management'));
            console.log(chalk.gray('To clean up runaway processes: mobi doctor clean [profile]'));
        }
    } catch (_error) {
        console.log(chalk.red('❌ Error checking runner status'));
    }

    // Log files - only show for 'all' filter
    if (filter === 'all') {
        console.log(chalk.bold('\n📝 Log Files'));

        // Get ALL log files
        const allLogs = getLogFiles(configuration.logsDir);
        
        if (allLogs.length > 0) {
            // Separate runner and regular logs
            const runnerLogs = allLogs.filter(({ file }) => file.includes('runner'));
            const regularLogs = allLogs.filter(({ file }) => !file.includes('runner'));

            // Show regular logs (max 10)
            if (regularLogs.length > 0) {
                console.log(chalk.blue('\nRecent Logs:'));
                const logsToShow = regularLogs.slice(0, 10);
                logsToShow.forEach(({ file, path, modified }) => {
                    console.log(`  ${chalk.green(file)} - ${modified.toLocaleString()}`);
                    console.log(chalk.gray(`    ${path}`));
                });
                if (regularLogs.length > 10) {
                    console.log(chalk.gray(`  ... and ${regularLogs.length - 10} more log files`));
                }
            }

            // Show runner logs (max 5)
            if (runnerLogs.length > 0) {
                console.log(chalk.blue('\nRunner Logs:'));
                const runnerLogsToShow = runnerLogs.slice(0, 5);
                runnerLogsToShow.forEach(({ file, path, modified }) => {
                    console.log(`  ${chalk.green(file)} - ${modified.toLocaleString()}`);
                    console.log(chalk.gray(`    ${path}`));
                });
                if (runnerLogs.length > 5) {
                    console.log(chalk.gray(`  ... and ${runnerLogs.length - 5} more runner log files`));
                }
            } else {
                console.log(chalk.yellow('\nNo runner log files found'));
            }
        } else {
            console.log(chalk.yellow('No log files found'));
        }

        // Support and bug reports
        console.log(chalk.bold('\n🐛 Support & Bug Reports'));
        const pkg = packageJson as unknown as { bugs?: string | { url?: string }; homepage?: string }
        const bugsUrl = typeof pkg.bugs === 'string' ? pkg.bugs : pkg.bugs?.url
        if (bugsUrl) {
            console.log(`Report issues: ${chalk.blue(bugsUrl)}`);
        }
        console.log(`Documentation: ${chalk.blue(pkg.homepage ?? 'See project README')}`);
    }

    console.log(chalk.green('\n✅ Doctor diagnosis complete!'));

    // 报告内置 claude 二进制解析结果（仅 'all' 过滤时展示，避免噪音）
    if (filter === 'all') {
        try {
            const resolved = await getClaudeExecutablePath();
            console.log(chalk.bold.cyan('\n🤖 Claude Binary'));
            if (process.env.MOBI_CLAUDE_PATH) {
                console.log(`  来源: ${chalk.yellow('MOBI_CLAUDE_PATH 覆盖')}`);
            } else if (isBunCompiled()) {
                console.log(`  来源: ${chalk.green('内置（extractFromBunfs）')}`);
            } else {
                console.log(`  来源: ${chalk.green('SDK 自动解析（dev 模式）')}`);
            }
            console.log(`  路径: ${resolved ?? '(由 SDK 运行时解析)'}`);
            if (resolved) {
                const { spawnSync } = await import('node:child_process');
                const r = spawnSync(resolved, ['--version'], { encoding: 'utf8', timeout: 10000 });
                console.log(`  版本: ${(r.stdout || '').trim() || chalk.red('运行失败')}`);
            }
        } catch (e) {
            console.log(chalk.yellow(`  Claude binary 解析失败: ${(e as Error).message}`));
        }
    }

    // 追加 Claude Code doctor 信息（仅 TTY 环境，claude doctor 需要交互输入）
    if (filter === 'all' && process.stdin.isTTY) {
        try {
            const claudePath = (await getClaudeExecutablePath()) ?? 'claude'
            console.log(chalk.bold.cyan('\n🔍 Claude Code Doctor\n'));

            await new Promise<void>((resolve) => {
                const child = spawn(claudePath, ['doctor'], {
                    stdio: 'inherit',
                    env: withBunRuntimeEnv(),
                    shell: false,
                })

                child.on('close', () => resolve())
                child.on('error', () => {
                    console.log(chalk.yellow('Could not run claude doctor. Make sure claude is installed.'))
                    resolve()
                })
            })
        } catch (e) {
            // 注意：claudePath 在 dev 态会回退到 'claude'（永不抛 not-found），
            // 这里捕获的是 spawn 前的其他异常（如 ENOENT on PATH、权限等），
            // 真正的 spawn 失败由上面的 child.on('error') 处理。
            console.log(chalk.yellow(`Could not launch claude doctor: ${(e as Error).message}`))
        }
    }

    console.log()
}
