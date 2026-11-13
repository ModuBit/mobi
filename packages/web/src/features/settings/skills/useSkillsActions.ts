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
 * skills 管理动作编排（架构深化候选⑧）：启停 / 删除确认 / 更新 / 安装 / 对话式新建
 * 五套「mutation + toast + 确认弹窗」流程收进一个 hook——此前内联在 SkillsSection，
 * 测试只能 mock 整个模块世界；收口后 section 只剩布局与呈现，mock 边界收窄到本 hook。
 */
import { App } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { SKILL_SCOPE_GLOBAL, extractHttpDetail, isSkillShadowed, type SkillInfo } from '@mobi/shared'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { useSkillCreatePrompt, useSkillDelete, useSkillInstall, useSkillUpdate, useSkillVisibility } from '@/core/data/hooks/queries/useSkills'
import { saveDraftText } from '@/core/lib/draftText'

// CLI 失败透传走 shared 单源 extractHttpDetail（errorPresentation 家族）

export function useSkillsActions() {
    const { t } = useTranslation()
    const { message, modal } = App.useApp()
    const navigate = useNavigate()
    const { data: workspaces } = useWorkspaces()

    const visibility = useSkillVisibility()
    const deletion = useSkillDelete()
    const updater = useSkillUpdate()
    const installer = useSkillInstall()
    /** 对话式新建的预填 prompt 请求（pending 态由 mutation 派生，与兄弟动作同构） */
    const creator = useSkillCreatePrompt()

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

    /** 删除：确认弹窗区分双路径文案；tracked 走 skills CLI（失败透传其输出） */
    const requestDelete = (skill: SkillInfo, scope: string) => {
        modal.confirm({
            title: t('settings.skills.deleteConfirmTitle', { name: skill.name }),
            content: skill.tracked
                ? t('settings.skills.deleteConfirmTracked', { source: skill.installSource ?? '' })
                : t('settings.skills.deleteConfirmUntracked'),
            okText: t('common.delete'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: async () => {
                try {
                    await deletion.mutateAsync({ name: skill.name, workspaceId: scope })
                    message.success(t('settings.skills.deleted'))
                } catch (error) {
                    message.error(extractHttpDetail(error) || t('settings.skills.deleteFailed'))
                }
            },
        })
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

    /** 安装：source + scope；成功返回 true（caller 关弹窗），失败保持弹窗开着可改后重试 */
    const install = async (source: string, scope: string): Promise<boolean> => {
        try {
            await installer.mutateAsync({ source, scope })
            message.success(t('settings.skills.installed'))
            return true
        } catch (error) {
            message.error(extractHttpDetail(error) || t('settings.skills.installFailed'))
            return false
        }
    }

    /** 对话式新建（票 07）：daemon 生成预填 prompt → 跨页草稿通道 + 跳新会话页；
     * 成功返回 true（caller 关弹窗）。会话宿主工作区：scope 是工作区即宿主，
     * global 任选一个（skill 写绝对路径与宿主无关）；无工作区无法建会话（必带 workspaceId）。 */
    const submitCreate = async (scope: string): Promise<boolean> => {
        const hostWorkspaceId = scope !== SKILL_SCOPE_GLOBAL ? scope : (workspaces ?? [])[0]?.id
        if (!hostWorkspaceId) {
            message.warning(t('settings.skills.createNoWorkspace'))
            return false
        }
        try {
            const res = await creator.mutateAsync(scope)
            // 一次性信箱：新会话页 shell ready 后消费预填
            saveDraftText(res.data.prompt)
            navigate({ to: '/sessions/new', search: { workspaceId: hostWorkspaceId } })
            return true
        } catch {
            message.error(t('settings.skills.createFailed'))
            return false
        }
    }

    return {
        toggle,
        requestDelete,
        update,
        install,
        submitCreate,
        /** 行级启停进行中（避免整列表闪烁） */
        isToggling: (name: string) => visibility.isPending && visibility.variables?.name === name,
        /** 行级更新进行中 */
        isUpdating: (name: string) => updater.isPending && updater.variables?.name === name,
        /** 安装请求进行中（提交钮 loading） */
        installing: installer.isPending,
        /** 新建请求进行中（提交钮 loading） */
        creating: creator.isPending,
    }
}
