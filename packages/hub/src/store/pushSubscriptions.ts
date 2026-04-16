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

import type { StoredPushSubscription } from './types'

type DbPushSubscriptionRow = {
    id: number
    namespace: string
    endpoint: string
    p256dh: string
    auth: string
    created_at: number
}

function toStoredPushSubscription(row: DbPushSubscriptionRow): StoredPushSubscription {
    return {
        id: row.id,
        namespace: row.namespace,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        createdAt: row.created_at
    }
}

export function addPushSubscription(
    db: Database,
    namespace: string,
    subscription: { endpoint: string; p256dh: string; auth: string }
): void {
    const now = Date.now()
    db.prepare(`
        INSERT INTO push_subscriptions (
            namespace, endpoint, p256dh, auth, created_at
        ) VALUES (
            @namespace, @endpoint, @p256dh, @auth, @created_at
        )
        ON CONFLICT(namespace, endpoint)
        DO UPDATE SET
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            created_at = excluded.created_at
    `).run({
        namespace,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        created_at: now
    })
}

export function removePushSubscription(db: Database, namespace: string, endpoint: string): void {
    db.prepare(
        'DELETE FROM push_subscriptions WHERE namespace = ? AND endpoint = ?'
    ).run(namespace, endpoint)
}

export function getPushSubscriptionsByNamespace(
    db: Database,
    namespace: string
): StoredPushSubscription[] {
    const rows = db.prepare(
        'SELECT * FROM push_subscriptions WHERE namespace = ? ORDER BY created_at DESC'
    ).all(namespace) as DbPushSubscriptionRow[]
    return rows.map(toStoredPushSubscription)
}
