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
 * 代码高亮语言子集注册（PrismLight 按需注册模式）。
 *
 * 背景：antdx CodeHighlighter 的 prismLightMode=false（全量 Prism）使
 * react-syntax-highlighter 整包（609KB：全量语言定义 + 所有变体）保持可达，
 * 与静态需要的 PrismLight 合并进同一个关键路径 chunk——性能基线（perf/基线.md
 * 爬山方向 #2）实测为 ready 路径最大热点。
 *
 * 改用 light 模式后只有这里静态注册的语言会着色；清单 = codeLanguageDetect
 * 的 hljs 候选语言全集 + prism 兜底四件套（markup/css/clike/js）+ jsx/tsx。
 * 未注册的语言（冷门显式 lang）降级为素码渲染，不再加载 609KB 全量包。
 */
import { PrismLight } from 'react-syntax-highlighter'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import clike from 'react-syntax-highlighter/dist/esm/languages/prism/clike'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin'
import lua from 'react-syntax-highlighter/dist/esm/languages/prism/lua'
import makefile from 'react-syntax-highlighter/dist/esm/languages/prism/makefile'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import objectivec from 'react-syntax-highlighter/dist/esm/languages/prism/objectivec'
import perl from 'react-syntax-highlighter/dist/esm/languages/prism/perl'
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php'
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import scala from 'react-syntax-highlighter/dist/esm/languages/prism/scala'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'

const LANGUAGES: Record<string, Parameters<typeof PrismLight.registerLanguage>[1]> = {
    markup, css, clike, javascript, typescript, jsx, tsx,
    python, java, go, rust, kotlin, swift, scala,
    c, cpp, csharp, objectivec,
    php, ruby, perl, lua,
    bash, powershell, sql, json, yaml, markdown, docker, makefile, ini, diff,
}

for (const [name, language] of Object.entries(LANGUAGES)) {
    PrismLight.registerLanguage(name, language)
}

/** 已注册语言名集合（对账测试消费：codeLanguageDetect 的候选集必须 ⊆ 此集合，防静默降级素码） */
export const REGISTERED_LANGUAGE_NAMES: ReadonlySet<string> = new Set(Object.keys(LANGUAGES))
