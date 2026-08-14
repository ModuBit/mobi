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
import { Alert, App, AutoComplete, Button, Drawer, Form, Input, Modal, Radio, Select, Spin, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { DesktopOutlined, FolderOutlined, HomeOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import { validateProjectFolders, type ProjectFolder, type ProjectFoldersError } from '@mobi/shared'
import { useMachines } from '@/core/data/hooks/queries/useMachines'
import { useCreateProject, useUpdateProject } from '@/core/data/hooks/mutations/useProjectMutations'
import { useMachineDirectoryListing } from '@/components/session/useMachineDirectoryListing'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import type { Project } from '@/core/data/api/types'
import { buildMachineSelectOptions } from '@/core/utils/machineUtils'
import { isPathWithinHomeDir } from '@/core/utils/path'

/**
 * folders 结构错误码 → i18n key（shared 只出码不出文案，见 ProjectFoldersError 注释）；
 * 空/primary 错误共用一条提示，空路径单独提示更具体
 */
const FOLDERS_ERROR_I18N: Record<ProjectFoldersError, string> = {
    empty: 'project.foldersInvalid',
    no_primary: 'project.foldersInvalid',
    multi_primary: 'project.foldersInvalid',
    empty_path: 'project.folderPathRequired',
}

/** 可编辑的文件夹行：带稳定 key（路径可编辑且可重复，不能当 React key） */
interface EditableFolder extends ProjectFolder {
    key: number
}

interface FolderRowProps {
    machineId: string | null
    homeDir: string | undefined
    folder: ProjectFolder
    /** 是否允许移除（至少保留一行，空列表由校验兜底提示） */
    canRemove: boolean
    disabled: boolean
    onPathChange: (path: string) => void
    onPrimaryChange: () => void
    onRemove: () => void
}

/** 单个文件夹行：路径输入（子目录补全）+ 主目录 Radio + 移除按钮（移动端纵向堆叠） */
function FolderRow({
    machineId, homeDir, folder, canRemove, disabled,
    onPathChange, onPrimaryChange, onRemove,
}: FolderRowProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const isMobile = useIsMobile()
    const { options, isLoading } = useMachineDirectoryListing(machineId, folder.path, homeDir)

    const autoCompleteOptions = useMemo(() => {
        if (!folder.path.trim() && homeDir) {
            // 空输入时给 home 目录快捷项（项目主目录通常从 home 开始输入）
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
                placeholder={t('project.folderPathPlaceholder')}
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
                    title={t('project.primary')}
                >
                    {t('project.primary')}
                </Radio>
                <Button
                    type="text"
                    size="small"
                    icon={<MinusOutlined />}
                    disabled={disabled || !canRemove}
                    onClick={onRemove}
                    title={t('project.removeFolder')}
                    style={{ color: canRemove ? token.colorError : undefined }}
                />
            </div>
        </div>
    )
}

export interface ProjectFormModalProps {
    open: boolean
    onClose: () => void
    /** 编辑模式传入项目实体；缺省为新建 */
    project?: Project | null
    /** 新建成功回调（携带创建出的项目实体，供调用方自动回填选中） */
    onCreated?: (project: Project) => void
}

/**
 * 项目新建/编辑共用表单弹窗（端别自适应：PC 居中 Modal / 移动端底部 Drawer）
 *
 * - name：项目名
 * - machine：所属机器（新建可选，编辑不可改——项目 folders 是机器本地路径，换机器无意义）
 * - folders：≥1 项且恰一项 primary（validateProjectFolders 把关，不通过禁用提交）
 */
export function ProjectFormModal({ open, onClose, project, onCreated }: ProjectFormModalProps) {
    const { t } = useTranslation()
    const { message: messageApi } = App.useApp()
    const isEdit = !!project
    const isMobile = useIsMobile()

    const { machines, isLoading: machinesLoading } = useMachines()

    const createMutation = useCreateProject()
    const updateMutation = useUpdateProject()
    const isPending = createMutation.isPending || updateMutation.isPending

    // 行 key 自增序号（组件实例内唯一即可；路径可编辑且可重复，不能当 key）
    const folderKeyRef = useRef(0)
    const nextFolderKey = useCallback(() => ++folderKeyRef.current, [])

    // 表单状态
    const [name, setName] = useState('')
    const [machineId, setMachineId] = useState<string | null>(null)
    const [folders, setFolders] = useState<EditableFolder[]>([{ key: 0, path: '', primary: true }])

    // 打开时按模式初始化（编辑回填 / 新建重置）——仅在打开/切换编辑对象时执行，
    // 不追踪 machines 等数据变化（避免表单被后台 refetch 覆盖用户输入）。
    // 同时快照初始 folders（path+primary 联合键）：home 范围校验只查「用户改动过的
    // path」、folders 未变时 patch 不传——早于 hub 前置校验创建的存量 home 外项目
    // 才不会连纯改名都被锁死
    const initialFolderKeysRef = useRef<Set<string>>(new Set())
    const folderKey = (f: { path: string; primary: boolean }) => `${f.path.trim()}|${f.primary}`
    useEffect(() => {
        if (!open) return
        if (project) {
            setName(project.name)
            setMachineId(project.machineId)
            setFolders(project.folders.map(f => ({ ...f, key: nextFolderKey() })))
            initialFolderKeysRef.current = new Set(project.folders.map(folderKey))
        } else {
            setName('')
            setMachineId(machines.length === 1 ? machines[0].id : null)
            setFolders([{ key: nextFolderKey(), path: '', primary: true }])
            initialFolderKeysRef.current = new Set()
        }
    }, [open, project?.id])

    // 单机时隐藏机器选择器，直接取唯一值（与新建会话的单一机器隐藏逻辑一致）
    const showMachineSelect = !isEdit && machines.length > 1
    useEffect(() => {
        if (isEdit) return
        if (machines.length === 1 && machineId !== machines[0].id) {
            setMachineId(machines[0].id)
        }
        if (machineId && !machines.find(m => m.id === machineId)) {
            setMachineId(machines.length === 1 ? machines[0].id : null)
        }
    }, [machines, machineId, isEdit])

    const currentMachine = machines.find(m => m.id === machineId)
    const machineHomeDir = currentMachine?.metadata?.homeDir as string | undefined

    // 校验：名称 + folders 结构（shared 出错误码）+ home 范围（与创建会话 cwd 同一约束）
    const nameError = name.trim() ? null : t('project.nameRequired')
    // folders 是否被改动（行级：path 或 primary 任一变化即算——path+primary 联合键）。
    // 存量项目可能含 home 外 path（早于 hub 前置校验创建），只拦新改动、放行未动的
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
        const code = validateProjectFolders(folders)
        if (code) return t(FOLDERS_ERROR_I18N[code])
        // 机器 homeDir 已知时，改动过的 folder 路径必须在其内（hub 侧 validateFoldersWithinHomeDir
        // 是提交后的服务端兜底，这里前置到表单即时反馈；homeDir 缺失时放行，与其语义一致）
        if (machineHomeDir && foldersChanged
            && folders.some(f => !isPathWithinHomeDir(f.path.trim(), machineHomeDir))) {
            return t('project.folderOutsideHome', { homeDir: machineHomeDir })
        }
        return null
    }, [folders, machineHomeDir, foldersChanged, t])
    const isValid = !nameError && !foldersError && !!machineId

    const handleAddFolder = useCallback(() => {
        setFolders(prev => [...prev, { key: nextFolderKey(), path: '', primary: false }])
    }, [nextFolderKey])

    const handleOk = async () => {
        if (!isValid || isPending) return
        // 提交前剥掉行 key（仅前端渲染用，不属于协议字段）
        const trimmedFolders = folders.map(f => ({ path: f.path.trim(), primary: f.primary }))
        try {
            if (isEdit && project) {
                await updateMutation.mutateAsync({
                    projectId: project.id,
                    // folders 未动就不传：hub 对显式传入的 folders 做全量 home 校验，
                    // 纯改名不应因存量 path 被拒（与上面行级校验的语义一致）
                    patch: foldersChanged
                        ? { name: name.trim(), folders: trimmedFolders }
                        : { name: name.trim() },
                })
            } else {
                const created = await createMutation.mutateAsync({
                    name: name.trim(),
                    machineId: machineId!,
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
            <Form.Item label={t('project.name')}>
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('project.namePlaceholder')}
                    disabled={isPending}
                    autoFocus
                />
            </Form.Item>

            {showMachineSelect && (
                <Form.Item label={<><DesktopOutlined style={{ marginRight: 4 }} />{t('project.machine')}</>}>
                    <Select
                        value={machineId ?? undefined}
                        onChange={setMachineId}
                        disabled={isPending}
                        loading={machinesLoading}
                        placeholder={machinesLoading ? t('newSession.machineLoading') : t('newSession.machinePlaceholder')}
                        options={buildMachineSelectOptions(machines)}
                    />
                </Form.Item>
            )}

            <Form.Item label={<><FolderOutlined style={{ marginRight: 4 }} />{t('project.folders')}</>}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {folders.map((folder, idx) => (
                        <FolderRow
                            key={folder.key}
                            machineId={machineId}
                            homeDir={machineHomeDir}
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
                        {t('project.addFolder')}
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

    const title = isEdit ? t('project.edit') : t('project.create')
    const okText = isEdit ? t('common.save') : t('project.create')

    // 移动端：底部 Drawer（height:auto / maxHeight:85vh / 底部 safe-area——web CLAUDE.md 规范），
    // 操作按钮随表单流入 body 底部（无 footer 栏）
    if (isMobile) {
        return (
            <Drawer
                title={title}
                open={open}
                onClose={() => { if (!isPending) onClose() }}
                placement="bottom"
                closable={false}
                maskClosable={!isPending}
                destroyOnClose
                styles={{
                    wrapper: { height: 'auto', maxHeight: '85vh' },
                    body: { paddingBottom: 'max(24px, env(safe-area-inset-bottom))' },
                }}
            >
                {formBody}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <Button block disabled={isPending} onClick={onClose}>
                        {t('common.cancel')}
                    </Button>
                    <Button block type="primary" disabled={!isValid} loading={isPending} onClick={handleOk}>
                        {okText}
                    </Button>
                </div>
            </Drawer>
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
            destroyOnClose
        >
            {formBody}
        </Modal>
    )
}
