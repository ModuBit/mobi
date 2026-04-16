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

import { isBunCompiled } from '@/projectPath';

export type BunRuntimeEnvOptions = {
    allowBunBeBun?: boolean;
};

function stripBunBeBun(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    if (!('BUN_BE_BUN' in env)) {
        return env;
    }

    const copy = { ...env };
    delete copy.BUN_BE_BUN;
    return copy;
}

export function withBunRuntimeEnv(
    env: NodeJS.ProcessEnv = process.env,
    options: BunRuntimeEnvOptions = {}
): NodeJS.ProcessEnv {
    if (!isBunCompiled()) {
        return env;
    }

    if (options.allowBunBeBun === false) {
        return stripBunBeBun(env);
    }

    return {
        ...env,
        BUN_BE_BUN: '1'
    };
}
