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

import { logger } from "@mobi/node-core/logger";
import { resolveTranscriptPath } from "@mobi/node-core/claudeSdk/transcriptPath";
import { existsSync, readFileSync } from "node:fs";

export function claudeCheckSession(sessionId: string, path: string) {
    const resolved = resolveTranscriptPath(sessionId, path);
    if (!resolved.ok) {
        logger.debug(`[claudeCheckSession] Cannot resolve transcript path (${resolved.reason})`);
        return false;
    }
    const sessionFile = resolved.path;
    const sessionExists = existsSync(sessionFile);
    if (!sessionExists) {
        logger.debug(`[claudeCheckSession] Path ${sessionFile} does not exist`);
        return false;
    }

    // Check if session contains any messages
    const sessionData = readFileSync(sessionFile, 'utf-8').split('\n');
    const hasGoodMessage = !!sessionData.find((v) => {
        try {
            return typeof JSON.parse(v).uuid === 'string'
        } catch (_e) {
            return false;
        }
    });

    return hasGoodMessage;
}