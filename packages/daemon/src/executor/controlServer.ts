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
 * HTTP control server for executor management
 * Provides endpoints for listing sessions, stopping sessions, and executor shutdown
 */

import fastify from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { logger } from '@mobi/node-core/logger';
import { Metadata } from '@mobi/node-core/api/types';
import { RUNNER_SESSION_STARTED_PATH } from '@mobi/shared/hostProtocol';
import { TrackedSession } from './types';

export function startExecutorControlServer({
  getChildren,
  stopSession,
  requestShutdown,
  onMobiSessionWebhook
}: {
  getChildren: () => TrackedSession[];
  stopSession: (sessionId: string) => boolean;
  requestShutdown: () => void;
  onMobiSessionWebhook: (sessionId: string, metadata: Metadata) => void;
}): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const app = fastify({
      logger: false // We use our own logger
    });

    // Set up Zod type provider
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>();

    // Session reports itself after creation（端点路径与请求体类型单源 @mobi/shared/hostProtocol；
    // 校验保持宽松 metadata 直传透传——收紧前必须核对 MetadataSchema 完整性）
    typed.post(RUNNER_SESSION_STARTED_PATH, {
      schema: {
        body: z.object({
          sessionId: z.string(),
          metadata: z.any() // Metadata type from API
        }),
        response: {
          200: z.object({
            status: z.literal('ok')
          })
        }
      }
    }, async (request) => {
      const { sessionId, metadata } = request.body;

      logger.debug(`[CONTROL SERVER] Session started: ${sessionId}`);
      onMobiSessionWebhook(sessionId, metadata);

      return { status: 'ok' as const };
    });

    // List all tracked sessions
    typed.post('/list', {
      schema: {
        response: {
          200: z.object({
            children: z.array(z.object({
              startedBy: z.string(),
              MobiSessionId: z.string(),
              pid: z.number()
            }))
          })
        }
      }
    }, async () => {
      const children = getChildren();
      logger.debug(`[CONTROL SERVER] Listing ${children.length} sessions`);
      return { 
        children: children
          .filter(child => child.MobiSessionId !== undefined)
          .map(child => ({
            startedBy: child.startedBy,
            MobiSessionId: child.MobiSessionId!,
            pid: child.pid
          }))
      }
    });

    // Stop specific session
    typed.post('/stop-session', {
      schema: {
        body: z.object({
          sessionId: z.string()
        }),
        response: {
          200: z.object({
            success: z.boolean()
          })
        }
      }
    }, async (request) => {
      const { sessionId } = request.body;

      logger.debug(`[CONTROL SERVER] Stop session request: ${sessionId}`);
      const success = stopSession(sessionId);
      return { success };
    });

    // Spawn new session
    // （端点已删，ticket-20：spawnRunnerSession 零调用方——spawn 唯一入口是
    //  daemon 进程内的 ExecutorBridge 直调）

    // Stop executor
    typed.post('/stop', {
      schema: {
        response: {
          200: z.object({
            status: z.string()
          })
        }
      }
    }, async () => {
      logger.debug('[CONTROL SERVER] Stop executor request received');

      // Give time for response to arrive
      setTimeout(() => {
        logger.debug('[CONTROL SERVER] Triggering executor shutdown');
        requestShutdown();
      }, 50);

      return { status: 'stopping' };
    });

    app.listen({ port: 0, host: '127.0.0.1' }, (err, address) => {
      if (err) {
        logger.debug('[CONTROL SERVER] Failed to start:', err);
        throw err;
      }

      const port = parseInt(address.split(':').pop()!);
      logger.debug(`[CONTROL SERVER] Started on port ${port}`);

      resolve({
        port,
        stop: async () => {
          logger.debug('[CONTROL SERVER] Stopping server');
          await app.close();
          logger.debug('[CONTROL SERVER] Server stopped');
        }
      });
    });
  });
}
