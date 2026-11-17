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
 * skills 管理动作编排（架构深化候选⑧）：启停 / 删除确认 / 更新 / 安装 四套
 * 「mutation + toast + 确认弹窗」流程收进一个 hook——此前内联在 SkillsSection，
 * 测试只能 mock 整个模块世界；收口后 section 只剩布局与呈现，mock 边界收窄到本 hook。
 */
import { App } from 'antd'
import { useTranslation } from 'react-i18next'
import { extractHttpDetail, isSkillShadowed, type SkillInfo, type SkillRegistrySkill } from '@mobi/shared'
import { useSkillAvailable, useSkillDelete, useSkillFind, useSkillInstall, useSkillUpdate, useSkillVisibility } from '@/core/data/hooks/queries/useSkills'

// CLI 失败透传走 shared 单源 extractHttpDetail（errorPresentation 家族）

export function useSkillsActions() {
    const { t } = useTranslation()
    const { message } = App.useApp()

    const visibility = useSkillVisibility()
    const deletion = useSkillDelete()
    const updater = useSkillUpdate()
    const installer = useSkillInstall()
    /** 两步式安装第一步的清单拉取（pending 态 = 弹窗「获取清单」按钮 loading） */
    const available = useSkillAvailable()
    /** 生态搜索（= CLI find）：安装弹窗输入段的关键词检索 */
    const finder = useSkillFind()

    /** 启停：失败报错；成功后归属层已开但生效仍关 → 更高层压制提示（isSkillShadowed 单源） */
    const toggle = (skill: SkillInfo, enabled: boolean, scope: string) => {
        visibility.mutate(
            { name: skill.name, enabled, workspaceId: scope },
            {
                onSuccess: (refreshed) => {
                    if (isSkillShadowed(refreshed)) {
                        message.warning(t('settings.skills.shadowedToast'))
                    }
                },
                onError: () => {
                    message.error(t('settings.skills.toggleFailed'))
                },
            },
        )
    }

    /** 更新（tracked 限定）：结果 toast（失败透传 CLI 输出） */
    const update = (skill: SkillInfo, scope: string) => {
        updater.mutate(
            { name: skill.name, workspaceId: scope },
            {
                onSuccess: () => message.success(t('settings.skills.updated')),
                onError: (error) => {
                    message.error(extractHttpDetail(error) || t('settings.skills.updateFailed'))
                },
            },
        )
    }

    /** 安装：source + scope + 勾选清单（缺省全装）；成功返回 true（caller 关弹窗），失败保持弹窗开着可改后重试。
     *  部分成功（200 带 failed）按成功关弹窗，失败项逐条 toast */
    const install = async (source: string, scope: string, skills?: string[]): Promise<boolean> => {
        try {
            const res = await installer.mutateAsync({ source, scope, skills })
            const failed = res.data.failed ?? []
            if (failed.length > 0) {
                for (const f of failed) message.warning(`${f.skill}: ${f.error}`)
            }
            message.success(t('settings.skills.installed'))
            return true
        } catch (error) {
            message.error(extractHttpDetail(error) || t('settings.skills.installFailed'))
            return false
        }
    }

    /** 两步式安装第一步：拉 repo 可用清单（失败报错返回 null，弹窗停留输入段） */
    const fetchAvailable = async (source: string, scope: string) => {
        try {
            const res = await available.mutateAsync({ source, workspaceId: scope })
            return res.data.skills
        } catch (error) {
            message.error(extractHttpDetail(error) || t('settings.skills.installFailed'))
            return null
        }
    }

    /** 生态搜索：关键词 → skills.sh 命中（失败报错返回 null，弹窗保留上次结果） */
    const find = async (query: string): Promise<SkillRegistrySkill[] | null> => {
        try {
            const res = await finder.mutateAsync(query)
            return res.data.skills
        } catch (error) {
            message.error(extractHttpDetail(error) || t('settings.skills.findFailed'))
            return null
        }
    }

    return {
        toggle,
        /** 详情 sheet 卸载：确认已由 ConfirmMorph 就地承担，直接执行（成功 toast，失败透传） */
        deleteDirect: async (skill: SkillInfo, scope: string) => {
            try {
                await deletion.mutateAsync({ name: skill.name, workspaceId: scope })
                message.success(t('settings.skills.deleted'))
                return true
            } catch (error) {
                message.error(extractHttpDetail(error) || t('settings.skills.deleteFailed'))
                return false
            }
        },
        update,
        install,
        fetchAvailable,
        find,
        /** 行级启停进行中（避免整列表闪烁） */
        isToggling: (name: string) => visibility.isPending && visibility.variables?.name === name,
        /** 行级更新进行中 */
        isUpdating: (name: string) => updater.isPending && updater.variables?.name === name,
    }
}
