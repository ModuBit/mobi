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

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface Settings {
    machineId?: string
    machineIdConfirmedByServer?: boolean
    runnerAutoStartWhenRunningMobi?: boolean
    cliApiToken?: string
    vapidKeys?: {
        publicKey: string
        privateKey: string
    }
    // Server configuration (persisted from environment variables)
    listenHost?: string
    listenPort?: number
    publicUrl?: string
    corsOrigins?: string[]
}

export function getSettingsFile(dataDir: string): string {
    return join(dataDir, 'settings.json')
}

/**
 * Read settings from file, preserving all existing fields.
 * Returns null if file exists but cannot be parsed (to avoid data loss).
 */
export async function readSettings(settingsFile: string): Promise<Settings | null> {
    if (!existsSync(settingsFile)) {
        return {}
    }
    try {
        const content = await readFile(settingsFile, 'utf8')
        return JSON.parse(content)
    } catch (error) {
        // Return null to signal parse error - caller should not overwrite
        console.error(`[WARN] Failed to parse ${settingsFile}: ${error}`)
        return null
    }
}

export async function readSettingsOrThrow(settingsFile: string): Promise<Settings> {
    const settings = await readSettings(settingsFile)
    if (settings === null) {
        throw new Error(
            `Cannot read ${settingsFile}. Please fix or remove the file and restart.`
        )
    }
    return settings
}

/**
 * Write settings to file atomically (temp file + rename)
 */
export async function writeSettings(settingsFile: string, settings: Settings): Promise<void> {
    const dir = dirname(settingsFile)
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true, mode: 0o700 })
    }

    const tmpFile = settingsFile + '.tmp'
    await writeFile(tmpFile, JSON.stringify(settings, null, 2))
    await rename(tmpFile, settingsFile)
}
