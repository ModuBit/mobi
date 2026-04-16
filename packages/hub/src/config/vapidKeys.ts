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

import { generateVAPIDKeys } from 'web-push'
import { getOrCreateSettingsValue } from './generators'
import { getSettingsFile } from './settings'

export type VapidKeys = {
    publicKey: string
    privateKey: string
}

export async function getOrCreateVapidKeys(dataDir: string): Promise<VapidKeys> {
    const settingsFile = getSettingsFile(dataDir)
    const result = await getOrCreateSettingsValue({
        settingsFile,
        readValue: (settings) => {
            if (settings.vapidKeys?.publicKey && settings.vapidKeys?.privateKey) {
                return { value: settings.vapidKeys }
            }
            return null
        },
        writeValue: (settings, value) => {
            settings.vapidKeys = value
        },
        generate: () => {
            const generated = generateVAPIDKeys()
            return {
                publicKey: generated.publicKey,
                privateKey: generated.privateKey
            }
        }
    })

    return result.value
}
