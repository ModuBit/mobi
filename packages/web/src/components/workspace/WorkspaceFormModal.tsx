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

import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { Alert, App, AutoComplete, Button, Form, Input, Modal, Radio, Spin, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { FolderOutlined, HomeOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import { MobileDrawer } from '@/components/ui/MobileDrawer'
import { validateWorkspaceFolders, type WorkspaceFolder, type WorkspaceFoldersError } from '@mobi/shared'
import { useDaemonStatus } from '@/core/data/hooks/queries/useDaemonStatus'
import { useCreateWorkspace, useUpdateWorkspace } from '@/core/data/hooks/mutations/useWorkspaceMutations'
import { useMachineDirectoryListing } from '@/components/session/useMachineDirectoryListing'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import type { Workspace } from '@/core/data/api/types'
import { isPathWithinHomeDir } from '@/core/utils/path'

/**
 * folders 结构错误码 → i18n key（shared 只出码不出文案，见 WorkspaceFoldersError 注释）；
 * 空/primary 错误共用一条提示，空路径单独提示更具体
 */
const FOLDERS_ERROR_I18N: Record<WorkspaceFoldersError, string> = {
    empty: 'workspace.foldersInvalid',
    no_primary: 'workspace.foldersInvalid',
    multi_primary: 'workspace.foldersInvalid',
    empty_path: 'workspace.folderPathRequired',
}

/** 可编辑的文件夹行：带稳定 key（路径可编辑且可重复，不能当 React key） */
interface EditableFolder extends WorkspaceFolder {
    key: number
}

interface FolderRowProps {
    homeDir: string | undefined
    folder: WorkspaceFolder
    /** 是否允许移除（至少保留一行，空列表由校验兜底提示） */
    canRemove: boolean
    disabled: boolean
    onPathChange: (path: string) => void
    onPrimaryChange: () => void
    onRemove: () => void
}

/** 单个文件夹行：路径输入（子目录补全）+ 主目录 Radio + 移除按钮（移动端纵向堆叠） */
function FolderRow({
    homeDir, folder, canRemove, disabled,
    onPathChange, onPrimaryChange, onRemove,
}: FolderRowProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const isMobile = useIsMobile()
    const { options, isLoading } = useMachineDirectoryListing(folder.path, homeDir)

    const autoCompleteOptions = useMemo(() => {
        if (!folder.path.trim() && homeDir) {
            // 空输入时给 home 目录快捷项（工作区主目录通常从 home 开始输入）
            return [{ value: homeDir, label: homeDir }]
        }
        return options.map(opt => ({ value: opt.value, label: opt.label }))
    }, [folder.path, options, homeDir])

    return (
        <div style={isMobile
            ? { display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }
            : { display: 'flex', alignItems: 'center', gap: 8 }}
        >
            <AutoComplete
                value={folder.path}
                options={autoCompleteOptions}
                onChange={onPathChange}
                placeholder={t('workspace.folderPathPlaceholder')}
                disabled={disabled}
                style={{ flex: 1, width: isMobile ? '100%' : undefined }}
                popupMatchSelectWidth={false}
                suffixIcon={isLoading ? <Spin size="small" /> : undefined}
                onSelect={(value) => onPathChange(value)}
            />
            {/* 移动端窄屏一行放不下：Radio + 移除按钮单独一行，两端对齐 */}
            <div style={isMobile
                ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
                : { display: 'contents' }}
            >
                <Radio
                    checked={folder.primary}
                    onChange={onPrimaryChange}
                    disabled={disabled}
                    title={t('workspace.primary')}
                >
                    {t('workspace.primary')}
                </Radio>
                <Button
                    type="text"
                    size="small"
                    icon={<MinusOutlined />}
                    disabled={disabled || !canRemove}
                    onClick={onRemove}
                    title={t('workspace.removeFolder')}
                    aria-label={t('workspace.removeFolder')}
                    style={{ color: canRemove ? token.colorError : undefined }}
                />
            </div>
        </div>
    )
}

export interface WorkspaceFormModalProps {
    open: boolean
    onClose: () => void
    /** 编辑模式传入工作区实体；缺省为新建 */
    workspace?: Workspace | null
    /** 新建成功回调（携带创建出的工作区实体，供调用方自动回填选中） */
    onCreated?: (workspace: Workspace) => void
}

/**
 * 工作区新建/编辑共用表单弹窗（端别自适应：PC 居中 Modal / 移动端底部 Drawer）
 *
 * - name：工作区名
 * - machine：所属机器（新建可选，编辑不可改——工作区 folders 是机器本地路径，换机器无意义）
 * - folders：≥1 项且恰一项 primary（validateWorkspaceFolders 把关，不通过禁用提交）
 */
export function WorkspaceFormModal({ open, onClose, workspace, onCreated }: WorkspaceFormModalProps) {
    const { t } = useTranslation()
    const { message: messageApi } = App.useApp()
    const isEdit = !!workspace
    const isMobile = useIsMobile()

    const { status: daemonStatus } = useDaemonStatus()
    const hostHomeDir = daemonStatus?.host?.homeDir

    const createMutation = useCreateWorkspace()
    const updateMutation = useUpdateWorkspace()
    const isPending = createMutation.isPending || updateMutation.isPending

    // 行 key 自增序号（组件实例内唯一即可；路径可编辑且可重复，不能当 key）
    const folderKeyRef = useRef(0)
    const nextFolderKey = useCallback(() => ++folderKeyRef.current, [])

    // 表单状态
    const [name, setName] = useState('')
    const [folders, setFolders] = useState<EditableFolder[]>([{ key: 0, path: '', primary: true }])

    // 打开时按模式初始化（编辑回填 / 新建重置）——仅在打开/切换编辑对象时执行，
    // 不追踪 machines 等数据变化（避免表单被后台 refetch 覆盖用户输入）。
    // 同时快照初始 folders（path+primary 联合键）：home 范围校验只查「用户改动过的
    // path」、folders 未变时 patch 不传——早于 hub 前置校验创建的存量 home 外工作区
    // 才不会连纯改名都被锁死
    const initialFolderKeysRef = useRef<Set<string>>(new Set())
    const folderKey = (f: { path: string; primary: boolean }) => `${f.path.trim()}|${f.primary}`
    useEffect(() => {
        if (!open) return
        if (workspace) {
            setName(workspace.name)
            setFolders(workspace.folders.map(f => ({ ...f, key: nextFolderKey() })))
            initialFolderKeysRef.current = new Set(workspace.folders.map(folderKey))
        } else {
            setName('')
            setFolders([{ key: nextFolderKey(), path: '', primary: true }])
            initialFolderKeysRef.current = new Set()
        }
    }, [open, workspace?.id, nextFolderKey])


    // 校验：名称 + folders 结构（shared 出错误码）+ home 范围（与创建会话 cwd 同一约束）
    const nameError = name.trim() ? null : t('workspace.nameRequired')
    // folders 是否被改动（行级：path 或 primary 任一变化即算——path+primary 联合键）。
    // 存量工作区可能含 home 外 path（早于 hub 前置校验创建），只拦新改动、放行未动的
    // 旧值——否则机器后来才上报 homeDir 时，纯改名也会被整体锁死且无绕过入口
    const foldersChanged = useMemo(
        () => {
            const initial = initialFolderKeysRef.current
            return initial.size !== folders.length
                || folders.some(f => !initial.has(folderKey(f)))
        },
        [folders],
    )
    const foldersError = useMemo(() => {
        const code = validateWorkspaceFolders(folders)
        if (code) return t(FOLDERS_ERROR_I18N[code])
        // 机器 homeDir 已知时，改动过的 folder 路径必须在其内（hub 侧 validateFoldersWithinHomeDir
        // 是提交后的服务端兜底，这里前置到表单即时反馈；homeDir 缺失时放行，与其语义一致）
        if (hostHomeDir && foldersChanged
            && folders.some(f => !isPathWithinHomeDir(f.path.trim(), hostHomeDir))) {
            return t('workspace.folderOutsideHome', { homeDir: hostHomeDir })
        }
        return null
    }, [folders, hostHomeDir, foldersChanged, t])
    const isValid = !nameError && !foldersError

    const handleAddFolder = useCallback(() => {
        setFolders(prev => [...prev, { key: nextFolderKey(), path: '', primary: false }])
    }, [nextFolderKey])

    const handleOk = async () => {
        if (!isValid || isPending) return
        // 提交前剥掉行 key（仅前端渲染用，不属于协议字段）
        const trimmedFolders = folders.map(f => ({ path: f.path.trim(), primary: f.primary }))
        try {
            if (isEdit && workspace) {
                await updateMutation.mutateAsync({
                    workspaceId: workspace.id,
                    // folders 未动就不传：hub 对显式传入的 folders 做全量 home 校验，
                    // 纯改名不应因存量 path 被拒（与上面行级校验的语义一致）
                    patch: foldersChanged
                        ? { name: name.trim(), folders: trimmedFolders }
                        : { name: name.trim() },
                })
            } else {
                const created = await createMutation.mutateAsync({
                    name: name.trim(),
                    folders: trimmedFolders,
                })
                onCreated?.(created)
            }
            messageApi.success(t('common.success'))
            onClose()
        } catch {
            messageApi.error(t('common.error'))
        }
    }

    // 表单体两端共享，仅外壳随端别切换
    const formBody = (
        <Form layout="vertical" requiredMark={false} style={{ marginTop: 16 }}>
            <Form.Item label={t('workspace.name')}>
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('workspace.namePlaceholder')}
                    disabled={isPending}
                    autoFocus
                />
            </Form.Item>

            <Form.Item label={<><FolderOutlined style={{ marginRight: 4 }} />{t('workspace.folders')}</>}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {folders.map((folder, idx) => (
                        <FolderRow
                            key={folder.key}
                            homeDir={hostHomeDir}
                            folder={folder}
                            canRemove={folders.length > 1}
                            disabled={isPending}
                            onPathChange={(path) => setFolders(prev =>
                                prev.map((f, i) => (i === idx ? { ...f, path } : f))
                            )}
                            onPrimaryChange={() => setFolders(prev =>
                                prev.map((f, i) => ({ ...f, primary: i === idx }))
                            )}
                            onRemove={() => setFolders(prev =>
                                prev.filter((_, i) => i !== idx)
                            )}
                        />
                    ))}
                    <Button
                        type="dashed"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={handleAddFolder}
                        disabled={isPending}
                        style={{ alignSelf: 'flex-start' }}
                    >
                        {t('workspace.addFolder')}
                    </Button>
                </div>
            </Form.Item>

            {(nameError || foldersError) && (
                <Alert
                    type="warning"
                    showIcon
                    icon={<HomeOutlined />}
                    message={nameError ?? foldersError}
                    style={{ marginBottom: 8 }}
                />
            )}
        </Form>
    )

    const title = isEdit ? t('workspace.edit') : t('workspace.create')
    const okText = isEdit ? t('common.save') : t('workspace.create')

    // 移动端：底部 MobileDrawer（统一行为：header 下拉手势关闭 + 手势返回按层级关闭——
    // 哨兵栈保证多层覆盖物后入先出；height:auto / maxHeight:85dvh 由 MobileDrawer 内置），
    // 操作按钮随表单流入 body 底部（无 footer 栏），safe-area 下沉到按钮容器
    if (isMobile) {
        return (
            <MobileDrawer
                title={title}
                open={open}
                onClose={() => { if (!isPending) onClose() }}
                maskClosable={!isPending}
                destroyOnHidden
            >
                {formBody}
                <div style={{
                    display: 'flex', gap: 8, marginTop: 16,
                    paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
                }}>
                    <Button block disabled={isPending} onClick={onClose}>
                        {t('common.cancel')}
                    </Button>
                    <Button block type="primary" disabled={!isValid} loading={isPending} onClick={handleOk}>
                        {okText}
                    </Button>
                </div>
            </MobileDrawer>
        )
    }

    return (
        <Modal
            title={title}
            open={open}
            onOk={handleOk}
            onCancel={onClose}
            confirmLoading={isPending}
            okButtonProps={{ disabled: !isValid }}
            okText={okText}
            cancelText={t('common.cancel')}
            destroyOnHidden
        >
            {formBody}
        </Modal>
    )
}
