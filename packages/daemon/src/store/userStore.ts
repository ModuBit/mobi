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

import type { Database } from 'bun:sqlite'

import type { StoredUser } from './types'
import { addUser, getUser, getUsersByPlatform, getUsersByPlatformAndNamespace, removeUser } from './users'

export class UserStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getUser(platform: string, platformUserId: string): StoredUser | null {
        return getUser(this.db, platform, platformUserId)
    }

    getUsersByPlatform(platform: string): StoredUser[] {
        return getUsersByPlatform(this.db, platform)
    }

    getUsersByPlatformAndNamespace(platform: string, namespace: string): StoredUser[] {
        return getUsersByPlatformAndNamespace(this.db, platform, namespace)
    }

    addUser(platform: string, platformUserId: string, namespace: string): StoredUser {
        return addUser(this.db, platform, platformUserId, namespace)
    }

    removeUser(platform: string, platformUserId: string): boolean {
        return removeUser(this.db, platform, platformUserId)
    }
}
