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

/** 截尾保尾部：超过 maxChars 时保留末段（崩溃现场/stderr tail 的滑动窗口）。
 *  此前同一惯用法在 supervisor（8000）与 executor spawn（4000）各写一份 */
export function keepTail(text: string, maxChars: number): string {
    return text.length > maxChars ? text.slice(-maxChars) : text
}
