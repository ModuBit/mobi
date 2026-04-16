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

import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { configuration } from '../configuration'
import { getOrCreateJsonFile } from './generators'

const ownerIdFileSchema = z.object({
    ownerId: z.number()
})

function generateOwnerId(): number {
    const bytes = randomBytes(6)
    let value = 0
    for (const byte of bytes) {
        value = (value << 8) + byte
    }
    return value > 0 ? value : 1
}

let cachedOwnerId: number | null = null

export async function getOrCreateOwnerId(): Promise<number> {
    if (cachedOwnerId !== null) {
        return cachedOwnerId
    }

    const ownerIdFile = join(configuration.dataDir, 'owner-id.json')

    const result = await getOrCreateJsonFile({
        filePath: ownerIdFile,
        readValue: (raw) => {
            const parsed = ownerIdFileSchema.parse(JSON.parse(raw))
            if (!Number.isSafeInteger(parsed.ownerId) || parsed.ownerId <= 0) {
                throw new Error(`Invalid ownerId in ${ownerIdFile}`)
            }
            return parsed.ownerId
        },
        writeValue: (ownerId) => JSON.stringify({ ownerId }, null, 4),
        generate: generateOwnerId,
        fileMode: 0o600,
        dirMode: 0o700
    })

    cachedOwnerId = result.value
    return result.value
}
