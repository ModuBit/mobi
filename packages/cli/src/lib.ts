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
 * Library exports for slopus package
 * 
 * This file provides the main API classes and types for external consumption
 * without the CLI-specific functionality.
 */

// These exports allow me to use this package a library in dev-environment cli helper programs
export { ApiClient } from '@/api/api'
export { ApiSessionClient } from '@/api/apiSession'

export { logger } from '@/ui/logger'
export { configuration } from '@/configuration'

export { RawJSONLinesSchema, type RawJSONLines } from '@/claude/types'