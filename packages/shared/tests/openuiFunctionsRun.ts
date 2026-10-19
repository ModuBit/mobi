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
 * @函数测试夹具（移植自 thesysdev/open-intelligent-ui MIT 的
 * `src/lib/functions/__tests__/run.ts`，去掉了 demo 自定义 actions）：
 * 用真实的 1.0 parser + evaluator 求值 `@Name(args)`——测试的是模型调用
 * 函数的真实路径（含参数 schema 校验、抛错转 null），而不是直接调 fn。
 */

import {
    action,
    createLibrary,
    createParser,
    defineComponent,
    evaluate,
    evaluateElementProps,
    type ActionPlan,
    type OpenUIError,
} from '@openuidev/lang-core'
import { z } from 'zod'
import { openuiFunctions } from '../src/openuiFunctions'

/** 单属性组件：任意表达式都能被真实 parser/evaluator 解析求值 */
const Out = defineComponent({
    name: 'Out',
    props: z.object({ value: z.any(), action: action().optional() }),
    description: 'Test output',
    component: null,
})
const library = createLibrary({ root: 'Out', components: [Out], functions: openuiFunctions })
const schema = library.toJSONSchema()
const parser = createParser(schema, 'Out')
const fns = Object.fromEntries(
    Object.entries(schema.functions ?? {}).map(([name, spec]) => [name, { ...spec, fn: library.functions?.[name]?.fn }]),
)

/** 求值 `root = Out(expr)` 及附加语句；state 覆盖 $变量初值 */
export function run(expr: string, extra = '', state: Record<string, unknown> = {}) {
    const parsed = parser.parse(`root = Out(${expr})\n${extra}`)
    const store: Record<string, unknown> = { ...parsed.stateDeclarations, ...state }
    const errors: OpenUIError[] = []
    const ctx = {
        getState: (n: string) => store[n],
        resolveRef: () => undefined,
        functions: fns,
        actions: schema.actions,
    }
    const el = evaluateElementProps(parsed.root!, { ctx, library, store: null, errors })
    const props = el.props as { value: unknown; action?: ActionPlan }
    return {
        value: props.value,
        action: props.action,
        parseErrors: parsed.meta.errors.map((e) => e.message),
        runtimeErrors: errors.map((e) => e.message),
    }
}

/** `@Name(args)` 的求值结果 */
export const value = (expr: string) => run(expr).value
