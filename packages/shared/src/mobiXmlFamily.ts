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
 * XML 指令族的成员注册表（spec .scratch/mobi-xml-namespace）：哪些标签构成族、命中
 * 归属哪个成员、去重键怎么路由——单源在此，消费方（web 域组装、tokenizer、测试）只
 * 引用不重抄。新增族成员 = 成员语义模块 + 此处注册一项。
 *
 * 分层：mobiXml 管族通用原语（扫描/去重/截断），本模块管「族由谁组成」；quote 成员
 * 语义在 quoteProtocol、artifact 在 mobiXml——本模块只做绑定，不新增语义。
 */
import {
    ARTIFACT_TAG_NAMES,
    artifactDedupeKey,
    buildXmlTokenShape,
    opensOf,
    type XmlTagHit,
} from './mobiXml'
import { QUOTE_TAG_NAMES, quoteDedupeKey } from './quoteProtocol'

/** 族成员注册项：标签清单（读兼容矩阵）+ attrs → 去重键（null = 不参与去重） */
export interface MobiXmlMember {
    /** 成员名：兼作去重键前缀（键空间按成员隔离，保证键全局唯一） */
    name: string
    tagNames: readonly string[]
    dedupeKey: (attrs: Record<string, string>) => string | null
}

/** 现行族成员：quote（引用标注）+ artifact（产物声明） */
const MEMBERS: readonly MobiXmlMember[] = [
    { name: 'quote', tagNames: QUOTE_TAG_NAMES, dedupeKey: quoteDedupeKey },
    { name: 'artifact', tagNames: ARTIFACT_TAG_NAMES, dedupeKey: artifactDedupeKey },
]

/** 标签名 → 所属成员（去重键路由共用） */
const MEMBER_BY_TAG = new Map<string, MobiXmlMember>()
for (const member of MEMBERS) {
    for (const tag of member.tagNames) MEMBER_BY_TAG.set(tag, member)
}

/** 族标签形态清单（现行 + legacy 读兼容），tokenizer / 去重 / 截断共用 */
export const MOBI_XML_FAMILY_TAG_NAMES: readonly string[] = MEMBERS.flatMap(m => [...m.tagNames])

/** 族标签开前缀清单（守卫 / tokenizer 起点扫描共用，opensOf 单源派生禁手抄） */
export const MOBI_XML_FAMILY_OPENS: readonly string[] = opensOf(MOBI_XML_FAMILY_TAG_NAMES)

/** 族 tokenizer 正形（外层整组包裹的锚定语义单源在 buildXmlTokenShape） */
export const MOBI_XML_FAMILY_TOKEN_SHAPE = buildXmlTokenShape(MOBI_XML_FAMILY_TAG_NAMES)

/**
 * 族命中 → 去重键：按命中标签路由所属成员，键以成员名前缀隔离（键全局唯一性单源
 * 在此——quote 跨标签同 index 收敛同键，artifact 按成员语义前缀隔离）。未登记标签
 * / 成员键为 null → null（不参与去重，原样保留）。
 */
export function mobiXmlDedupeKey(hit: XmlTagHit): string | null {
    const member = MEMBER_BY_TAG.get(hit.tagName)
    if (member === undefined) return null
    const key = member.dedupeKey(hit.attrs)
    return key === null ? null : `${member.name}\0${key}`
}
