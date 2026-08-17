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

import { describe, it, expect } from 'vitest';
import { MessageQueue } from '@/utils/MessageQueue';
import { hashObject } from '@/utils/deterministicJson';

describe('MessageQueue', () => {
    it('should create a queue', () => {
        const queue = new MessageQueue<string>(mode => mode);
        expect(queue.size()).toBe(0);
        expect(queue.isClosed()).toBe(false);
    });

    it('should push and retrieve messages with same mode', async () => {
        const queue = new MessageQueue<string>(mode => mode);
        
        queue.push('message1', 'local');
        queue.push('message2', 'local');
        queue.push('message3', 'local');
        
        const result = await queue.waitForMessagesAndGetAsString();
        expect(result).not.toBeNull();
        expect(result?.message).toBe('message1\nmessage2\nmessage3');
        expect(result?.mode).toBe('local');
        expect(queue.size()).toBe(0);
    });

    it('should return only messages with same mode and keep others', async () => {
        const queue = new MessageQueue<string>(mode => mode);
        
        queue.push('local1', 'local');
        queue.push('local2', 'local');
        queue.push('remote1', 'remote');
        queue.push('remote2', 'remote');
        
        // First call should return local messages
        const result1 = await queue.waitForMessagesAndGetAsString();
        expect(result1).not.toBeNull();
        expect(result1?.message).toBe('local1\nlocal2');
        expect(result1?.mode).toBe('local');
        expect(queue.size()).toBe(2); // remote messages still in queue
        
        // Second call should return remote messages
        const result2 = await queue.waitForMessagesAndGetAsString();
        expect(result2).not.toBeNull();
        expect(result2?.message).toBe('remote1\nremote2');
        expect(result2?.mode).toBe('remote');
        expect(queue.size()).toBe(0);
    });

    it('should handle complex mode objects', async () => {
        interface Mode {
            type: string;
            context?: string;
        }

        const queue = new MessageQueue<Mode>(
            mode => `${mode.type}-${mode.context || 'default'}`
        );

        queue.push('message1', { type: 'local' });
        queue.push('message2', { type: 'local' });
        queue.push('message3', { type: 'local', context: 'test' });

        // First batch - same mode hash
        const result1 = await queue.waitForMessagesAndGetAsString();
        expect(result1).not.toBeNull();
        expect(result1?.message).toBe('message1\nmessage2');
        expect(result1?.mode).toEqual({ type: 'local' });

        // Second batch - different context
        const result2 = await queue.waitForMessagesAndGetAsString();
        expect(result2).not.toBeNull();
        expect(result2?.message).toBe('message3');
        expect(result2?.mode).toEqual({ type: 'local', context: 'test' });
    });

    it('noBatch 消息在队首时单独成批，不与后续同 mode 消息合并', async () => {
        const queue = new MessageQueue<string>(mode => mode);

        queue.pushNoBatch('! ls', 'local', 'loc-bash');
        queue.push('你好', 'local', 'loc-1');

        const result1 = await queue.waitForMessagesAndGetAsString();
        expect(result1?.message).toBe('! ls');
        expect(result1?.localIds).toEqual(['loc-bash']);
        expect(result1?.isolate).toBe(false); // noBatch 无 isolate 的重启暂存语义

        const result2 = await queue.waitForMessagesAndGetAsString();
        expect(result2?.message).toBe('你好');
        expect(result2?.localIds).toEqual(['loc-1']);
        expect(queue.size()).toBe(0);
    });

    it('noBatch 消息排在后面时，前方同 mode 批次在其前截断', async () => {
        const queue = new MessageQueue<string>(mode => mode);

        queue.push('你好', 'local', 'loc-1');
        queue.pushNoBatch('! ls', 'local', 'loc-bash');
        queue.push('再问', 'local', 'loc-2');

        const result1 = await queue.waitForMessagesAndGetAsString();
        expect(result1?.message).toBe('你好');
        expect(result1?.localIds).toEqual(['loc-1']);

        const result2 = await queue.waitForMessagesAndGetAsString();
        expect(result2?.message).toBe('! ls');
        expect(result2?.localIds).toEqual(['loc-bash']);

        const result3 = await queue.waitForMessagesAndGetAsString();
        expect(result3?.message).toBe('再问');
        expect(result3?.localIds).toEqual(['loc-2']);
    });

    it('should wait for messages when queue is empty', async () => {
        const queue = new MessageQueue<string>(mode => mode);
        
        // Start waiting
        const waitPromise = queue.waitForMessagesAndGetAsString();
        
        // Push messages while waiting
        setTimeout(() => {
            queue.push('delayed1', 'local');
            queue.push('delayed2', 'local');
        }, 10);
        
        const result = await waitPromise;
        expect(result).not.toBeNull();
        expect(result?.message).toBe('delayed1\ndelayed2');
        expect(result?.mode).toBe('local');
    });

    it('should return null when waiting and queue closes', async () => {
        const queue = new MessageQueue<string>(mode => mode);
        
        // Start waiting
        const waitPromise = queue.waitForMessagesAndGetAsString();
        
        // Close queue
        setTimeout(() => {
            queue.close();
        }, 10);
        
        const result = await waitPromise;
        expect(result).toBeNull();
    });

    it('should handle abort signal', async () => {
        const queue = new MessageQueue<string>(mode => mode);
        const abortController = new AbortController();
        
        // Start waiting
        const waitPromise = queue.waitForMessagesAndGetAsString(abortController.signal);
        
        // Abort
        setTimeout(() => {
            abortController.abort();
        }, 10);
        
        const result = await waitPromise;
        expect(result).toBeNull();
    });

    it('should return null immediately if abort signal is already aborted', async () => {
        const queue = new MessageQueue<string>(mode => mode);
        const abortController = new AbortController();
        
        // Abort before calling
        abortController.abort();
        
        const result = await queue.waitForMessagesAndGetAsString(abortController.signal);
        expect(result).toBeNull();
    });

    it('should handle abort signal with existing messages', async () => {
        const queue = new MessageQueue<string>(mode => mode);
        const abortController = new AbortController();
        
        // Add messages
        queue.push('message1', 'local');
        
        // Should return messages even with abort signal
        const result = await queue.waitForMessagesAndGetAsString(abortController.signal);
        expect(result).not.toBeNull();
        expect(result?.message).toBe('message1');
    });

    it('should throw when pushing to closed queue', () => {
        const queue = new MessageQueue<string>(mode => mode);
        queue.close();
        
        expect(() => queue.push('message', 'local')).toThrow('Cannot push to closed queue');
    });

    it('should handle multiple waiting and pushing cycles', async () => {
        const queue = new MessageQueue<string>(mode => mode);
        
        // First cycle
        queue.push('cycle1', 'mode1');
        const result1 = await queue.waitForMessagesAndGetAsString();
        expect(result1?.message).toBe('cycle1');
        expect(result1?.mode).toBe('mode1');
        
        // Second cycle with waiting
        const waitPromise = queue.waitForMessagesAndGetAsString();
        queue.push('cycle2', 'mode2');
        const result2 = await waitPromise;
        expect(result2?.message).toBe('cycle2');
        expect(result2?.mode).toBe('mode2');
        
        // Third cycle
        queue.push('cycle3-1', 'mode3');
        queue.push('cycle3-2', 'mode3');
        const result3 = await queue.waitForMessagesAndGetAsString();
        expect(result3?.message).toBe('cycle3-1\ncycle3-2');
        expect(result3?.mode).toBe('mode3');
    });

    it('should batch messages with enhanced mode hashing', async () => {
        
        interface EnhancedMode {
            permissionMode: string;
            model?: string;
            fallbackModel?: string;
            customSystemPrompt?: string;
            appendSystemPrompt?: string;
            allowedTools?: string[];
            disallowedTools?: string[];
        }
        
        const queue = new MessageQueue<EnhancedMode>(mode => hashObject(mode));
        
        // Push messages with different enhanced mode combinations
        queue.push('message1', { permissionMode: 'default', model: 'sonnet' });
        queue.push('message2', { permissionMode: 'default', model: 'sonnet' }); // Same as message1
        queue.push('message3', { permissionMode: 'default', model: 'haiku' }); // Different model
        queue.push('message4', { permissionMode: 'default', fallbackModel: 'opus' }); // Different fallback model
        queue.push('message5', { permissionMode: 'default', customSystemPrompt: 'You are a helpful assistant' }); // Different system prompt
        queue.push('message6', { permissionMode: 'default', appendSystemPrompt: 'Be concise' }); // Different append prompt
        queue.push('message7', { permissionMode: 'default', allowedTools: ['Read', 'Write'] }); // Different allowed tools
        queue.push('message8', { permissionMode: 'default', disallowedTools: ['Bash'] }); // Different disallowed tools
        
        // First batch - same permission mode and model
        const result1 = await queue.waitForMessagesAndGetAsString();
        expect(result1).not.toBeNull();
        expect(result1?.message).toBe('message1\nmessage2');
        expect(result1?.mode).toEqual({ permissionMode: 'default', model: 'sonnet' });
        expect(queue.size()).toBe(6); // remaining messages in queue
        
        // Second batch - same permission mode, different model
        const result2 = await queue.waitForMessagesAndGetAsString();
        expect(result2).not.toBeNull();
        expect(result2?.message).toBe('message3');
        expect(result2?.mode).toEqual({ permissionMode: 'default', model: 'haiku' });
        expect(queue.size()).toBe(5); // remaining messages
        
        // Third batch - same permission mode, fallback model
        const result3 = await queue.waitForMessagesAndGetAsString();
        expect(result3).not.toBeNull();
        expect(result3?.message).toBe('message4');
        expect(result3?.mode).toEqual({ permissionMode: 'default', fallbackModel: 'opus' });
        expect(queue.size()).toBe(4); // remaining messages
        
        // Fourth batch - same permission mode, custom system prompt
        const result4 = await queue.waitForMessagesAndGetAsString();
        expect(result4).not.toBeNull();
        expect(result4?.message).toBe('message5');
        expect(result4?.mode).toEqual({ permissionMode: 'default', customSystemPrompt: 'You are a helpful assistant' });
        expect(queue.size()).toBe(3); // remaining messages
        
        // Fifth batch - same permission mode, append system prompt
        const result5 = await queue.waitForMessagesAndGetAsString();
        expect(result5).not.toBeNull();
        expect(result5?.message).toBe('message6');
        expect(result5?.mode).toEqual({ permissionMode: 'default', appendSystemPrompt: 'Be concise' });
        expect(queue.size()).toBe(2); // remaining messages
        
        // Sixth batch - same permission mode, allowed tools
        const result6 = await queue.waitForMessagesAndGetAsString();
        expect(result6).not.toBeNull();
        expect(result6?.message).toBe('message7');
        expect(result6?.mode).toEqual({ permissionMode: 'default', allowedTools: ['Read', 'Write'] });
        expect(queue.size()).toBe(1); // one message left
        
        // Seventh batch - same permission mode, disallowed tools
        const result7 = await queue.waitForMessagesAndGetAsString();
        expect(result7).not.toBeNull();
        expect(result7?.message).toBe('message8');
        expect(result7?.mode).toEqual({ permissionMode: 'default', disallowedTools: ['Bash'] });
        expect(queue.size()).toBe(0);
    });

    it('should handle null reset values properly', async () => {
        
        interface EnhancedMode {
            permissionMode: string;
            model?: string;
            customSystemPrompt?: string;
            allowedTools?: string[];
            disallowedTools?: string[];
        }
        
        const queue = new MessageQueue<EnhancedMode>(mode => hashObject(mode));
        
        // Push messages with null reset behavior
        queue.push('message1', { permissionMode: 'default', model: 'sonnet' });
        queue.push('message2', { permissionMode: 'default', model: undefined }); // Reset
        queue.push('message3', { permissionMode: 'default', customSystemPrompt: 'You are helpful' });
        queue.push('message4', { permissionMode: 'default', customSystemPrompt: undefined }); // Reset
        queue.push('message5', { permissionMode: 'default', allowedTools: ['Read', 'Write'] });
        queue.push('message6', { permissionMode: 'default', allowedTools: undefined }); // Reset
        queue.push('message7', { permissionMode: 'default', disallowedTools: ['Bash'] });
        queue.push('message8', { permissionMode: 'default', disallowedTools: undefined }); // Reset
        
        // First batch - model set
        const result1 = await queue.waitForMessagesAndGetAsString();
        expect(result1).not.toBeNull();
        expect(result1?.message).toBe('message1');
        expect(result1?.mode).toEqual({ permissionMode: 'default', model: 'sonnet' });
        
        // Second batch - model reset (undefined)
        const result2 = await queue.waitForMessagesAndGetAsString();
        expect(result2).not.toBeNull();
        expect(result2?.message).toBe('message2');
        expect(result2?.mode).toEqual({ permissionMode: 'default' }); // No model field
        
        // Third batch - custom system prompt set
        const result3 = await queue.waitForMessagesAndGetAsString();
        expect(result3).not.toBeNull();
        expect(result3?.message).toBe('message3');
        expect(result3?.mode).toEqual({ permissionMode: 'default', customSystemPrompt: 'You are helpful' });
        
        // Fourth batch - custom system prompt reset (undefined)
        const result4 = await queue.waitForMessagesAndGetAsString();
        expect(result4).not.toBeNull();
        expect(result4?.message).toBe('message4');
        expect(result4?.mode).toEqual({ permissionMode: 'default' }); // No customSystemPrompt field
        
        // Fifth batch - allowed tools set
        const result5 = await queue.waitForMessagesAndGetAsString();
        expect(result5).not.toBeNull();
        expect(result5?.message).toBe('message5');
        expect(result5?.mode).toEqual({ permissionMode: 'default', allowedTools: ['Read', 'Write'] });
        
        // Sixth batch - allowed tools reset (undefined)
        const result6 = await queue.waitForMessagesAndGetAsString();
        expect(result6).not.toBeNull();
        expect(result6?.message).toBe('message6');
        expect(result6?.mode).toEqual({ permissionMode: 'default' }); // No allowedTools field
        
        // Seventh batch - disallowed tools set
        const result7 = await queue.waitForMessagesAndGetAsString();
        expect(result7).not.toBeNull();
        expect(result7?.message).toBe('message7');
        expect(result7?.mode).toEqual({ permissionMode: 'default', disallowedTools: ['Bash'] });
        
        // Eighth batch - disallowed tools reset (undefined)
        const result8 = await queue.waitForMessagesAndGetAsString();
        expect(result8).not.toBeNull();
        expect(result8?.message).toBe('message8');
        expect(result8?.mode).toEqual({ permissionMode: 'default' }); // No disallowedTools field
        
        expect(queue.size()).toBe(0);
    });

    it('should notify waiter immediately when message is pushed', async () => {
        const queue = new MessageQueue<string>(mode => mode);
        
        let resolved = false;
        const waitPromise = queue.waitForMessagesAndGetAsString().then(result => {
            resolved = true;
            return result;
        });
        
        // Should not be resolved yet
        expect(resolved).toBe(false);
        
        // Push message
        queue.push('immediate', 'local');
        
        // Give a tiny bit of time for promise to resolve
        await new Promise(resolve => setTimeout(resolve, 0));
        
        expect(resolved).toBe(true);
        const result = await waitPromise;
        expect(result?.message).toBe('immediate');
    });

    it('should batch messages pushed with pushImmediate normally', async () => {
        const queue = new MessageQueue<{ type: string }>((mode) => mode.type);
        
        // Add some regular messages
        queue.push('message1', { type: 'A' });
        queue.push('message2', { type: 'A' });
        
        // Add an immediate message (does not clear or isolate)
        queue.pushImmediate('immediate', { type: 'A' });
        
        // Add more messages after
        queue.push('message3', { type: 'A' });
        queue.push('message4', { type: 'A' });
        
        // All messages should be batched together since they have the same mode
        const batch1 = await queue.waitForMessagesAndGetAsString();
        expect(batch1?.message).toBe('message1\nmessage2\nimmediate\nmessage3\nmessage4');
        expect(batch1?.mode.type).toBe('A');
    });

    it('should isolate messages pushed with pushIsolateAndClear', async () => {
        const queue = new MessageQueue<{ type: string }>((mode) => mode.type);
        
        // Add some regular messages
        queue.push('message1', { type: 'A' });
        queue.push('message2', { type: 'A' });
        
        // Add an isolated message that clears the queue
        queue.pushIsolateAndClear('isolated', { type: 'A' });
        
        // Add more messages after
        queue.push('message3', { type: 'A' });
        queue.push('message4', { type: 'A' });
        
        // First batch should only contain the isolated message
        const batch1 = await queue.waitForMessagesAndGetAsString();
        expect(batch1?.message).toBe('isolated');
        expect(batch1?.mode.type).toBe('A');
        
        // Second batch should contain the messages added after
        const batch2 = await queue.waitForMessagesAndGetAsString();
        expect(batch2?.message).toBe('message3\nmessage4');
        expect(batch2?.mode.type).toBe('A');
    });

    it('should stop batching when hitting isolated message', async () => {
        const queue = new MessageQueue<{ type: string }>((mode) => mode.type);
        
        // Add regular messages
        queue.push('message1', { type: 'A' });
        queue.push('message2', { type: 'A' });
        
        // Manually add an isolated message without clearing (simulating edge case)
        queue.queue.push({
            message: 'isolated',
            mode: { type: 'A' },
            modeHash: 'A',
            isolate: true
        });
        
        // Add more regular messages
        queue.push('message3', { type: 'A' });
        
        // First batch should contain regular messages until the isolated one
        const batch1 = await queue.waitForMessagesAndGetAsString();
        expect(batch1?.message).toBe('message1\nmessage2');
        expect(batch1?.mode.type).toBe('A');
        
        // Second batch should only contain the isolated message
        const batch2 = await queue.waitForMessagesAndGetAsString();
        expect(batch2?.message).toBe('isolated');
        expect(batch2?.mode.type).toBe('A');
        
        // Third batch should contain messages after the isolated one
        const batch3 = await queue.waitForMessagesAndGetAsString();
        expect(batch3?.message).toBe('message3');
        expect(batch3?.mode.type).toBe('A');
    });

    it('should differentiate between pushImmediate and pushIsolateAndClear behavior', async () => {
        const queue = new MessageQueue<{ type: string }>((mode) => mode.type);
        
        // Test pushImmediate behavior - does NOT clear queue
        queue.push('before1', { type: 'A' });
        queue.push('before2', { type: 'A' });
        queue.pushImmediate('immediate', { type: 'A' });
        queue.push('after', { type: 'A' });
        
        // All should be batched together
        const batch1 = await queue.waitForMessagesAndGetAsString();
        expect(batch1?.message).toBe('before1\nbefore2\nimmediate\nafter');
        expect(batch1?.mode.type).toBe('A');
        
        // Test pushIsolateAndClear behavior - DOES clear queue and isolate
        queue.push('will-be-cleared1', { type: 'B' });
        queue.push('will-be-cleared2', { type: 'B' });
        queue.pushIsolateAndClear('isolated', { type: 'B' });
        queue.push('after-isolated', { type: 'B' });
        
        // First batch should only be the isolated message
        const batch2 = await queue.waitForMessagesAndGetAsString();
        expect(batch2?.message).toBe('isolated');
        expect(batch2?.mode.type).toBe('B');
        
        // Second batch should be the message added after
        const batch3 = await queue.waitForMessagesAndGetAsString();
        expect(batch3?.message).toBe('after-isolated');
        expect(batch3?.mode.type).toBe('B');
    });

    it('collectBatch 触发 onBatchConsumed 带 localIds', async () => {
        const queue = new MessageQueue<{ m: string }>(m => JSON.stringify(m));
        const consumed: string[][] = [];
        queue.setOnBatchConsumed(ids => consumed.push(ids));
        queue.push('a', { m: '1' }, 'loc-a');
        queue.push('b', { m: '1' }, 'loc-b');
        const r = await queue.waitForMessagesAndGetAsString();
        expect(r!.localIds).toEqual(['loc-a', 'loc-b']);
        expect(consumed).toEqual([['loc-a', 'loc-b']]);
    });

    it('cancelByLocalId 删除未消费消息', () => {
        const queue = new MessageQueue<{ m: string }>(m => JSON.stringify(m));
        queue.push('a', { m: '1' }, 'loc-a');
        expect(queue.cancelByLocalId('loc-a')).toBe(true);
        expect(queue.size()).toBe(0);
        expect(queue.cancelByLocalId('loc-a')).toBe(false);
    });

    it('stealByLocalId 取出并移除指定 localId，返回内容与 mode', () => {
        const queue = new MessageQueue<{ m: string }>(m => JSON.stringify(m));
        queue.push('hello', { m: '1' }, 'loc-a');
        queue.push('world', { m: '1' }, 'loc-b');

        const stolen = queue.stealByLocalId('loc-a');
        expect(stolen).toEqual({ message: 'hello', mode: { m: '1' } });

        // loc-a 已移除，collectBatch 只剩 loc-b
        const batch = queue.collectBatch();
        expect(batch?.localIds).toEqual(['loc-b']);
    });

    it('stealByLocalId 未命中返回 null', () => {
        const queue = new MessageQueue<{ m: string }>(m => JSON.stringify(m));
        expect(queue.stealByLocalId('nope')).toBeNull();
    });

    it('peekByLocalId 读取消息但不移除（steer 前探测用）', () => {
        const queue = new MessageQueue<{ m: string }>(m => JSON.stringify(m));
        queue.push('hello', { m: '1' }, 'loc-1');
        expect(queue.peekByLocalId('loc-1')?.message).toBe('hello');
        // 未移除：仍可 steal
        expect(queue.stealByLocalId('loc-1')?.message).toBe('hello');
        expect(queue.size()).toBe(0);
    });

    it('peekByLocalId 未命中返回 null', () => {
        const queue = new MessageQueue<{ m: string }>(m => JSON.stringify(m));
        expect(queue.peekByLocalId('nope')).toBeNull();
    });

    it('特殊命令 isolate 入队后 peek 不破坏 isolate（防 steer 回归）', async () => {
        // 回归场景：/clear 经 pushIsolateAndClear 入队（isolate=true，必须单独投递）。
        // steer 前用 peek 探测特殊命令后应保留原队列项不动，collectBatch 仍按 isolate
        // 单独投递，不与后续同 mode 消息合并——否则 "msgB\n/clear" 会被当普通文本发 Claude。
        const queue = new MessageQueue<string>(m => m);
        queue.pushIsolateAndClear('/clear', 'local', 'loc-clear');
        queue.push('msgB', 'local', 'loc-b');
        // peek 不移除，队列原样
        expect(queue.peekByLocalId('loc-clear')?.message).toBe('/clear');
        expect(queue.size()).toBe(2);
        // isolate 首条 → 单独投递，msgB 不并入
        const result = await queue.waitForMessagesAndGetAsString();
        expect(result?.message).toBe('/clear');
        expect(result?.isolate).toBe(true);
    });

    it('pushAndClear 清空排队项时触发 onBatchConsumed（防悬浮条卡死）', () => {
        const queue = new MessageQueue<{ m: string }>(m => JSON.stringify(m));
        const consumed: string[][] = [];
        queue.setOnBatchConsumed(ids => consumed.push(ids));
        // 先放两条带 localId 的排队消息
        queue.push('a', { m: '1' }, 'loc-a');
        queue.push('b', { m: '1' }, 'loc-b');
        // pushAndClear 清空它们、推入 /compact（带自己的 localId）
        queue.pushAndClear('compact', { m: '1' }, 'loc-compact');
        // 被丢弃的 loc-a/loc-b 应通过 onBatchConsumed 通知；loc-compact 是新推的、不在丢弃集
        expect(consumed).toContainEqual(['loc-a', 'loc-b']);
        // 队列只剩 /compact
        expect(queue.size()).toBe(1);
    });
});
describe('MessageQueue in-flight（取消/steer 竞态防护）', () => {
    it('collectBatch 后 localId 标记 in-flight，tryCancel 返回 submitted', async () => {
        const queue = new MessageQueue<string>(mode => mode);
        queue.push('msg', 'local', 'loc-1');
        const r = await queue.waitForMessagesAndGetAsString();
        expect(r?.localIds).toEqual(['loc-1']);
        // 已 collectBatch（即将喂给 agent）→ 不可取消
        expect(queue.tryCancel('loc-1')).toBe('submitted');
    });

    it('stealByLocalId 后标记 in-flight，tryCancel 返回 submitted', () => {
        const queue = new MessageQueue<string>(mode => mode);
        queue.push('msg', 'local', 'loc-1');
        expect(queue.stealByLocalId('loc-1')).not.toBeNull();
        expect(queue.tryCancel('loc-1')).toBe('submitted');
    });

    it('仍在队列（未 collect）→ tryCancel 移除并返回 cancelled', () => {
        const queue = new MessageQueue<string>(mode => mode);
        queue.push('msg', 'local', 'loc-1');
        expect(queue.tryCancel('loc-1')).toBe('cancelled');
        expect(queue.size()).toBe(0);
    });

    it('未知 localId（尚未送达 CLI）→ not-in-queue（交由 Hub DB 裁决）', () => {
        const queue = new MessageQueue<string>(mode => mode);
        expect(queue.tryCancel('never')).toBe('not-in-queue');
    });

    it('reset 清空 in-flight 集合', async () => {
        const queue = new MessageQueue<string>(mode => mode);
        queue.push('msg', 'local', 'loc-1');
        await queue.waitForMessagesAndGetAsString();
        expect(queue.tryCancel('loc-1')).toBe('submitted');
        queue.reset();
        expect(queue.tryCancel('loc-1')).toBe('not-in-queue');
    });
});

describe('MessageQueue in-flight 有界化', () => {
    it('inFlight 超过 IN_FLIGHT_CAP 淘汰最旧，但 everDispatched 仍记其曾 shift → tryCancel 保守 submitted', async () => {
        const mod = await import('@/utils/MessageQueue');
        const cap = mod.IN_FLIGHT_CAP;
        const queue = new MessageQueue<string>(mode => mode);
        // 推入 cap+5 条同模式消息，一次 collectBatch 全部消费 → 全标 in-flight，inFlight 超限淘汰最旧
        for (let i = 0; i < cap + 5; i++) {
            queue.push(`m${i}`, 'local', `loc-${i}`);
        }
        await queue.waitForMessagesAndGetAsString();
        // inFlight 已淘汰 loc-0，但其曾 shift 出队列（喂给 agent）→ 保守不可取消（防幽灵消息）
        expect(queue.tryCancel('loc-0')).toBe('submitted');
        // 最新条目仍在 in-flight
        expect(queue.tryCancel(`loc-${cap + 4}`)).toBe('submitted');
    });

    it('everDispatched 超过 EVER_DISPATCHED_CAP 后才彻底遗忘 → not-in-queue（最终兜底）', async () => {
        const mod = await import('@/utils/MessageQueue');
        const cap = mod.EVER_DISPATCHED_CAP;
        const queue = new MessageQueue<string>(mode => mode);
        // 用反射塞满 everDispatched（loc-0..loc-(cap-1)），避免 cap 次真实消费拖慢测试
        const dispatched = (queue as unknown as { everDispatchedLocalIds: Map<string, true> }).everDispatchedLocalIds;
        for (let i = 0; i < cap; i++) dispatched.set(`loc-${i}`, true);
        // 再消费一条 → markInFlight 使 everDispatched size=cap+1 → 淘汰最旧 loc-0
        queue.push('new', 'local', 'loc-new');
        await queue.waitForMessagesAndGetAsString();
        expect(queue.tryCancel('loc-0')).toBe('not-in-queue');
        // loc-new 与其他仍在 everDispatched → submitted
        expect(queue.tryCancel('loc-new')).toBe('submitted');
    });
});

describe('MessageQueue pushAfterClear 的丢弃项亦标 in-flight', () => {
    it('pushAndClear 丢弃的 localId 标 in-flight，tryCancel 返回 submitted（与 collectBatch 语义一致）', () => {
        const queue = new MessageQueue<{ m: string }>(m => JSON.stringify(m));
        // 先放两条带 localId 的排队消息
        queue.push('a', { m: '1' }, 'loc-a');
        queue.push('b', { m: '1' }, 'loc-b');
        // pushAndClear 清空它们、推入 /compact
        queue.pushAndClear('compact', { m: '1' }, 'loc-compact');
        // 被丢弃的 loc-a/loc-b 已「离开队列」（即将经 onBatchConsumed 标 consumed）→ 不可取消
        expect(queue.tryCancel('loc-a')).toBe('submitted');
        expect(queue.tryCancel('loc-b')).toBe('submitted');
    });
});

describe('MessageQueue clearPending（rewind 前清空）', () => {
    it('清空队列并经 onBatchConsumed 通知丢弃项（与 pushAfterClear 同路径）', async () => {
        const queue = new MessageQueue<{ m: string }>(m => JSON.stringify(m));
        const consumed: string[][] = [];
        queue.setOnBatchConsumed((localIds) => consumed.push(localIds));

        queue.push('a', { m: '1' }, 'loc-a');
        queue.push('b', { m: '1' }, 'loc-b');
        queue.push('c', { m: '1' });  // 无 localId（不应出现在通知里）

        queue.clearPending();

        expect(queue.size()).toBe(0);
        expect(consumed).toEqual([['loc-a', 'loc-b']]);
        // 丢弃项已标 in-flight：此窗口内不可取消（防幽灵消息，与 collectBatch/steal 语义一致）
        expect(queue.tryCancel('loc-a')).toBe('submitted');
        expect(queue.tryCancel('loc-b')).toBe('submitted');
    });

    it('空队列 clearPending 为无操作（不触发空通知）', () => {
        const queue = new MessageQueue<{ m: string }>(m => JSON.stringify(m));
        const consumed: string[][] = [];
        queue.setOnBatchConsumed((localIds) => consumed.push(localIds));

        queue.clearPending();

        expect(queue.size()).toBe(0);
        expect(consumed).toEqual([]);
    });

    it('清空后可继续 push（不注入新消息，区别于 pushAfterClear）', () => {
        const queue = new MessageQueue<{ m: string }>(m => JSON.stringify(m));

        queue.push('a', { m: '1' }, 'loc-a');
        queue.clearPending();
        queue.push('next', { m: '1' }, 'loc-next');

        expect(queue.size()).toBe(1);
        expect(queue.peekByLocalId('loc-next')?.message).toBe('next');
    });
});
