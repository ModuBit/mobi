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

export function trimIdent(text: string): string {
    // Split the text into an array of lines
    const lines = text.split('\n');

    // Remove leading and trailing empty lines
    while (lines.length > 0 && lines[0].trim() === '') {
        lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }

    // Find the minimum number of leading spaces in non-empty lines
    const minSpaces = lines.reduce((min, line) => {
        if (line.trim() === '') {
            return min;
        }
        const leadingSpaces = line.match(/^\s*/)![0].length;
        return Math.min(min, leadingSpaces);
    }, Infinity);

    // Remove the common leading spaces from each line
    const trimmedLines = lines.map(line => line.slice(minSpaces));

    // Join the trimmed lines back into a single string
    return trimmedLines.join('\n');
}