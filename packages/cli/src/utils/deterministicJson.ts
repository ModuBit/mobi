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
 * Deterministic JSON utilities for consistent object serialization and hashing
 * 
 * Provides stable JSON stringification with sorted keys and consistent handling
 * of edge cases like undefined, circular references, and special types.
 * 
 * Used for:
 * - Consistent encryption/decryption in API communication
 * - Reliable message deduplication in session scanning
 * - Stable object comparison for optimistic concurrency
 */

import { createHash } from 'crypto';

/**
 * Options for deterministic JSON stringification
 */
export interface DeterministicJsonOptions {
    /** How to handle undefined values */
    undefinedBehavior?: 'omit' | 'null' | 'throw';
    /** Whether to sort array contents (default: false) */
    sortArrays?: boolean;
    /** Custom replacer function */
    replacer?: (key: string, value: unknown) => unknown;
    /** Whether to include Symbol properties (default: false) */
    includeSymbols?: boolean;
}

/**
 * Deterministically stringify a JSON object with sorted keys
 * 
 * @param obj Object to stringify
 * @param options Stringification options
 * @returns Deterministic JSON string
 */
export function deterministicStringify(
    obj: unknown,
    options: DeterministicJsonOptions = {}
): string {
    const {
        undefinedBehavior = 'omit',
        sortArrays = false,
        replacer,
        includeSymbols = false
    } = options;

    const seen = new WeakSet<object>();

    function processValue(value: unknown, key?: string): unknown {
        // Handle replacer function
        if (replacer && key !== undefined) {
            value = replacer(key, value);
        }

        // Handle primitive types
        if (value === null) return null;
        if (value === undefined) {
            switch (undefinedBehavior) {
                case 'omit': return undefined;
                case 'null': return null;
                case 'throw': throw new Error(`Undefined value at key: ${key}`);
            }
        }
        if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
            return value;
        }

        // Handle special types
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (value instanceof RegExp) {
            return value.toString();
        }
        if (typeof value === 'function') {
            return undefined; // Functions are omitted
        }
        if (typeof value === 'symbol') {
            return includeSymbols ? value.toString() : undefined;
        }
        if (typeof value === 'bigint') {
            return value.toString() + 'n';
        }

        // 排除所有 primitive 后,value 必为 object。断言以继续属性访问
        if (typeof value !== 'object') return undefined;
        const obj = value as Record<string, unknown> & { constructor?: unknown };

        // Handle circular references
        if (seen.has(obj)) {
            throw new Error('Circular reference detected');
        }
        seen.add(obj);

        // Handle arrays
        if (Array.isArray(obj)) {
            const processed = obj.map((item, index) => processValue(item, String(index)))
                .filter(item => item !== undefined);

            if (sortArrays) {
                // Sort arrays by their stringified content for true determinism
                processed.sort((a, b) => {
                    const aStr = JSON.stringify(processValue(a));
                    const bStr = JSON.stringify(processValue(b));
                    return aStr.localeCompare(bStr);
                });
            }

            seen.delete(obj);
            return processed;
        }

        // Handle objects
        if (obj.constructor === Object || obj.constructor === undefined) {
            const processed: Record<string, unknown> = {};
            const keys = Object.keys(obj).sort();

            for (const k of keys) {
                const processedValue = processValue(obj[k], k);
                if (processedValue !== undefined) {
                    processed[k] = processedValue;
                }
            }

            seen.delete(obj);
            return processed;
        }

        // Handle other object types (like class instances)
        // Try to convert to plain object
        try {
            const plain = { ...obj };
            seen.delete(obj);
            return processValue(plain, key);
        } catch {
            seen.delete(obj);
            return String(obj);
        }
    }

    const processed = processValue(obj);
    return JSON.stringify(processed);
}

/**
 * Calculate SHA-256 hash of an object using deterministic JSON stringification
 * 
 * @param obj Object to hash
 * @param options Stringification options
 * @param encoding Output encoding (default: 'hex')
 * @returns Hash string
 */
export function hashObject(
    obj: unknown,
    options?: DeterministicJsonOptions,
    encoding: 'hex' | 'base64' | 'base64url' = 'hex'
): string {
    const jsonString = deterministicStringify(obj, options);
    return createHash('sha256').update(jsonString).digest(encoding);
}

/**
 * Compare two objects for deep equality using deterministic stringification
 * 
 * @param a First object
 * @param b Second object
 * @param options Stringification options
 * @returns True if objects are deeply equal
 */
export function deepEqual(
    a: unknown,
    b: unknown,
    options?: DeterministicJsonOptions
): boolean {
    try {
        return deterministicStringify(a, options) === deterministicStringify(b, options);
    } catch {
        return false;
    }
}

/**
 * Create a stable hash key for an object suitable for use as a Map key
 * 
 * @param obj Object to create key for
 * @param options Stringification options
 * @returns Stable string key
 */
export function objectKey(
    obj: unknown,
    options?: DeterministicJsonOptions
): string {
    return hashObject(obj, options, 'base64url');
}