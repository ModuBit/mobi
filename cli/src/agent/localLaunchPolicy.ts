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

export type StartedBy = 'runner' | 'terminal';

export type LocalLaunchExitReason = 'switch' | 'exit';

export type LocalLaunchContext = {
    startedBy?: StartedBy;
    startingMode?: 'local' | 'remote';
};

export function getLocalLaunchExitReason(context: LocalLaunchContext): LocalLaunchExitReason {
    if (context.startedBy === 'runner' || context.startingMode === 'remote') {
        return 'switch';
    }

    return 'exit';
}
