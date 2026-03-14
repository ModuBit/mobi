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
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { readSettingsOrThrow, writeSettings, type Settings } from './settings'

export type GetOrCreateResult<T> = {
    value: T
    created: boolean
}

export type SettingsValueReadResult<T> = {
    value: T
    writeBack?: boolean
}

export async function getOrCreateSettingsValue<T>(options: {
    settingsFile: string
    readValue: (settings: Settings) => SettingsValueReadResult<T> | null
    writeValue: (settings: Settings, value: T) => void
    generate: () => T
}): Promise<GetOrCreateResult<T>> {
    const settings = await readSettingsOrThrow(options.settingsFile)
    const existing = options.readValue(settings)
    if (existing) {
        if (existing.writeBack) {
            await writeSettings(options.settingsFile, settings)
        }
        return { value: existing.value, created: false }
    }

    const generated = options.generate()
    options.writeValue(settings, generated)
    await writeSettings(options.settingsFile, settings)
    return { value: generated, created: true }
}

export async function getOrCreateJsonFile<T>(options: {
    filePath: string
    readValue: (raw: string) => T
    writeValue: (value: T) => string
    generate: () => T
    fileMode?: number
    dirMode?: number
}): Promise<GetOrCreateResult<T>> {
    const fileMode = options.fileMode ?? 0o600
    const dirMode = options.dirMode ?? 0o700

    if (existsSync(options.filePath)) {
        await chmod(options.filePath, fileMode).catch(() => {})
        const raw = await readFile(options.filePath, 'utf8')
        return { value: options.readValue(raw), created: false }
    }

    const generated = options.generate()
    const dir = dirname(options.filePath)
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true, mode: dirMode })
    }

    await writeFile(options.filePath, options.writeValue(generated), { mode: fileMode })
    await chmod(options.filePath, fileMode).catch(() => {})
    return { value: generated, created: true }
}
