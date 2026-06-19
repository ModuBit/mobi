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

import type { ApiSessionClient } from '@/api/apiSession'
import { logger } from '@/ui/logger'
import { restoreTerminalState } from '@/ui/terminalState'

type RunnerLifecycleOptions = {
    apiSession: ApiSessionClient
    logTag: string
    stopKeepAlive?: () => void
    onBeforeClose?: () => Promise<void> | void
    onAfterClose?: () => Promise<void> | void
}

export type RunnerLifecycle = {
    setExitCode: (code: number) => void
    setArchiveReason: (reason: string) => void
    markCrash: (error: unknown) => void
    cleanup: () => Promise<void>
    cleanupAndExit: (codeOverride?: number) => Promise<void>
    registerProcessHandlers: () => void
}

export function createRunnerLifecycle(options: RunnerLifecycleOptions): RunnerLifecycle {
    let exitCode = 0
    let archiveReason = 'User terminated'
    let _cleanupStarted = false
    let cleanupPromise: Promise<void> | null = null

    const logPrefix = `[${options.logTag}]`

    const archiveAndClose = async () => {
        options.apiSession.updateMetadata((currentMetadata) => ({
            ...currentMetadata,
            lifecycleState: 'archived',
            lifecycleStateSince: Date.now(),
            archivedBy: 'cli',
            archiveReason
        }))

        options.apiSession.sendSessionDeath()
        await options.apiSession.flush()
        await options.apiSession.close()
    }

    const cleanup = async () => {
        if (cleanupPromise) {
            return cleanupPromise
        }

        _cleanupStarted = true
        cleanupPromise = (async () => {
            logger.debug(`${logPrefix} Cleanup start`)
            restoreTerminalState()

            try {
                options.stopKeepAlive?.()
                await options.onBeforeClose?.()
                await archiveAndClose()
                logger.debug(`${logPrefix} Cleanup complete`)
            } finally {
                try {
                    await options.onAfterClose?.()
                } catch (error) {
                    logger.debug(`${logPrefix} Error during post-cleanup:`, error)
                }
            }
        })()

        return cleanupPromise
    }

    const cleanupAndExit = async (codeOverride?: number) => {
        if (codeOverride !== undefined) {
            exitCode = codeOverride
        }

        try {
            await cleanup()
            process.exit(exitCode)
        } catch (error) {
            logger.debug(`${logPrefix} Error during cleanup:`, error)
            process.exit(1)
        }
    }

    const setExitCode = (code: number) => {
        exitCode = code
    }

    const setArchiveReason = (reason: string) => {
        archiveReason = reason
    }

    const markCrash = (error: unknown) => {
        logger.debug(`${logPrefix} Unhandled error:`, error)
        exitCode = 1
        archiveReason = 'Session crashed'
    }

    const registerProcessHandlers = () => {
        process.on('SIGTERM', () => {
            void cleanupAndExit()
        })

        process.on('SIGINT', () => {
            void cleanupAndExit()
        })

        process.on('uncaughtException', (error) => {
            markCrash(error)
            void cleanupAndExit(1)
        })

        process.on('unhandledRejection', (reason) => {
            markCrash(reason)
            void cleanupAndExit(1)
        })
    }

    return {
        setExitCode,
        setArchiveReason,
        markCrash,
        cleanup,
        cleanupAndExit,
        registerProcessHandlers
    }
}

export function setControlledByUser(apiSession: ApiSessionClient, mode: 'local' | 'remote'): void {
    apiSession.updateAgentState((currentState) => ({
        ...currentState,
        controlledByUser: mode === 'local'
    }))
}

export function createModeChangeHandler(apiSession: ApiSessionClient): (mode: 'local' | 'remote') => void {
    return (mode) => {
        apiSession.sendSessionEvent({ type: 'switch', mode })
        setControlledByUser(apiSession, mode)
    }
}
