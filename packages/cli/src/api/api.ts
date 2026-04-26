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

import axios from 'axios'
import type { AgentState, CreateMachineResponse, CreateSessionResponse, RunnerState, Machine, MachineMetadata, Metadata, Session } from '@/api/types'
import { AgentStateSchema, CreateMachineResponseSchema, CreateSessionResponseSchema, RunnerStateSchema, MachineMetadataSchema, MetadataSchema } from '@/api/types'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { apiValidationError } from '@/utils/errorUtils'
import { logger } from '@/ui/logger'
import { ApiMachineClient } from './apiMachine'
import { ApiSessionClient } from './apiSession'

export class ApiClient {
    static async create(): Promise<ApiClient> {
        return new ApiClient(getAuthToken())
    }

    private constructor(private readonly token: string) { }

    async getSessionByClaudeSessionId(claudeSessionId: string): Promise<Session | null> {
        try {
            const response = await axios.get<{ session: CreateSessionResponse['session'] }>(
                `${configuration.apiUrl}/cli/sessions/by-claude-session/${encodeURIComponent(claudeSessionId)}`,
                {
                    headers: {
                        Authorization: `Bearer ${this.token}`
                    },
                    timeout: 10_000
                }
            )

            const parsed = CreateSessionResponseSchema.safeParse(response.data)
            if (!parsed.success) {
                logger.debug('[ApiClient] getSessionByClaudeSessionId 响应格式异常，降级为新建')
                return null
            }

            const raw = parsed.data.session

            const metadata = (() => {
                if (raw.metadata == null) return null
                const parsedMetadata = MetadataSchema.safeParse(raw.metadata)
                return parsedMetadata.success ? parsedMetadata.data : null
            })()

            const agentState = (() => {
                if (raw.agentState == null) return null
                const parsedAgentState = AgentStateSchema.safeParse(raw.agentState)
                return parsedAgentState.success ? parsedAgentState.data : null
            })()

            return {
                id: raw.id,
                namespace: raw.namespace,
                seq: raw.seq,
                createdAt: raw.createdAt,
                updatedAt: raw.updatedAt,
                active: raw.active,
                activeAt: raw.activeAt,
                metadata,
                metadataVersion: raw.metadataVersion,
                agentState,
                agentStateVersion: raw.agentStateVersion,
                running: raw.running,
                runningAt: raw.runningAt,
                runtimeState: raw.runtimeState,
                permissionMode: raw.permissionMode,
                tag: raw.tag
            }
        } catch (error: unknown) {
            // 404 → session 不存在，正常情况
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return null
            }
            // 其他错误（网络等）→ 降级为新建
            logger.debug('[ApiClient] getSessionByClaudeSessionId 失败，降级为新建:', error)
            return null
        }
    }

    async getOrCreateSession(opts: {
        tag: string
        metadata: Metadata
        state: AgentState | null
        mode?: 'local' | 'remote'
    }): Promise<Session> {
        const response = await axios.post<CreateSessionResponse>(
            `${configuration.apiUrl}/cli/sessions`,
            {
                tag: opts.tag,
                metadata: opts.metadata,
                agentState: opts.state,
                mode: opts.mode
            },
            {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60_000
            }
        )

        const parsed = CreateSessionResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions response', response)
        }

        const raw = parsed.data.session

        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()

        const agentState = (() => {
            if (raw.agentState == null) return null
            const parsedAgentState = AgentStateSchema.safeParse(raw.agentState)
            return parsedAgentState.success ? parsedAgentState.data : null
        })()

        return {
            id: raw.id,
            namespace: raw.namespace,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            agentState,
            agentStateVersion: raw.agentStateVersion,
            running: raw.running,
            runningAt: raw.runningAt,
            runtimeState: raw.runtimeState,
            permissionMode: raw.permissionMode,
            tag: raw.tag
        }
    }

    async getOrCreateMachine(opts: {
        machineId: string
        metadata: MachineMetadata
        runnerState?: RunnerState
    }): Promise<Machine> {
        const response = await axios.post<CreateMachineResponse>(
            `${configuration.apiUrl}/cli/machines`,
            {
                id: opts.machineId,
                metadata: opts.metadata,
                runnerState: opts.runnerState ?? null
            },
            {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60_000
            }
        )

        const parsed = CreateMachineResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/machines response', response)
        }

        const raw = parsed.data.machine

        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MachineMetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()

        const runnerState = (() => {
            if (raw.runnerState == null) return null
            const parsedRunnerState = RunnerStateSchema.safeParse(raw.runnerState)
            return parsedRunnerState.success ? parsedRunnerState.data : null
        })()

        return {
            id: raw.id,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            runnerState,
            runnerStateVersion: raw.runnerStateVersion
        }
    }

    sessionSyncClient(session: Session): ApiSessionClient {
        return new ApiSessionClient(this.token, session)
    }

    machineSyncClient(machine: Machine): ApiMachineClient {
        return new ApiMachineClient(this.token, machine)
    }
}
