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

// bridge 订阅者的 uuid 去重集合：FIFO 淘汰 + 容量上限。
// goal tap（尾扫补偿）与 forked skill tap（流侧抑制）共用同一机制——长会话里
// 行数无界增长，不设上限即缓慢泄漏；容量上限只影响极旧行的幂等性，而那些行早已
// 离开重放窗口。

/**
 * 有容量上限的 uuid 集合：超过上限时淘汰最早加入的项。
 * 继承原生 Set，可直接作为 ReadonlySet 传给按集合判重的纯函数。
 */
export class BoundedUuidSet extends Set<string> {
    constructor(private readonly maxSize: number) {
        super();
    }

    override add(uuid: string): this {
        super.add(uuid);
        if (this.size > this.maxSize) {
            const oldest = this.values().next().value;
            if (oldest !== undefined) this.delete(oldest);
        }
        return this;
    }
}
