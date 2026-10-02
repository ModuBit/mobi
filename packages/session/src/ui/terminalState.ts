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

export function restoreTerminalState(): void {
    if (process.stdout.isTTY) {
        // Disable kitty keyboard protocol / CSI u key release reporting if enabled.
        process.stdout.write('\x1b[>4;0m');
        // Disable focus reporting to avoid stray ^[[I on mode switches.
        process.stdout.write('\x1b[?1004l');
        process.stdout.write('\x1b[?2004l');
    }
    if (process.stdin.isTTY) {
        try {
            process.stdin.setRawMode(false);
        } catch {
            // Ignore if raw mode is not supported.
        }
    }
}
