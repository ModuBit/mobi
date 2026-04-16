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

import { killRunawayMobiProcesses } from '@/runner/doctor'
import { runDoctorCommand } from '@/ui/doctor'
import type { CommandDefinition } from './types'

export const doctorCommand: CommandDefinition = {
    name: 'doctor',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        if (commandArgs[0] === 'clean') {
            const result = await killRunawayMobiProcesses()
            console.log(`Cleaned up ${result.killed} runaway processes`)
            if (result.errors.length > 0) {
                console.log('Errors:', result.errors)
            }
            process.exit(0)
        }
        await runDoctorCommand(commandArgs[0])
    }
}
