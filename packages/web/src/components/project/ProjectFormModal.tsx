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
import { Alert, App, AutoComplete, Button, Form, Input, Modal, Radio, Select, Spin, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { DesktopOutlined, FolderOutlined, HomeOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import { validateProjectFolders, type ProjectFolder } from '@mobi/shared'
import { useMachines } from '@/core/data/hooks/queries/useMachines'
import { useCreateProject, useUpdateProject } from '@/core/data/hooks/mutations/useProjectMutations'
import { useMachineDirectoryListing } from '@/components/session/useMachineDirectoryListing'
import type { Machine, Project } from '@/core/data/api/types'

/** 可编辑的文件夹行：带稳定 key（路径可编辑且可重复，不能当 React key） */
interface EditableFolder extends ProjectFolder {
    key: number
}

/** 获取机器显示名称（与 NewSessionForm 一致） */
function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
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

/** 单个文件夹行：路径输入（子目录补全）+ 主目录 Radio + 移除按钮 */
function FolderRow({
    machineId, homeDir, folder, canRemove, disabled,
    onPathChange, onPrimaryChange, onRemove,
}: FolderRowProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const { options, isLoading } = useMachineDirectoryListing(machineId, folder.path, homeDir)

    const autoCompleteOptions = useMemo(() => {
        if (!folder.path.trim() && homeDir) {
            // 空输入时给 home 目录快捷项（项目主目录通常从 home 开始输入）
            return [{ value: homeDir, label: homeDir }]
        }
        return options.map(opt => ({ value: opt.value, label: opt.label }))
    }, [folder.path, options, homeDir])

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AutoComplete
                value={folder.path}
                options={autoCompleteOptions}
                onChange={onPathChange}
                placeholder={t('project.folderPathPlaceholder')}
                disabled={disabled}
                style={{ flex: 1 }}
                popupMatchSelectWidth={false}
                suffixIcon={isLoading ? <Spin size="small" /> : undefined}
                onSelect={(value) => onPathChange(value)}
            />
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
    )
}

export interface ProjectFormModalProps {
    open: boolean
    onClose: () => void
    /** 编辑模式传入项目实体；缺省为新建 */
    project?: Project | null
}

/**
 * 项目新建/编辑共用表单弹窗
 *
 * - name：项目名
 * - machine：所属机器（新建可选，编辑不可改——项目 folders 是机器本地路径，换机器无意义）
 * - folders：≥1 项且恰一项 primary（validateProjectFolders 把关，不通过禁用提交）
 */
export function ProjectFormModal({ open, onClose, project }: ProjectFormModalProps) {
    const { t } = useTranslation()
    const { message: messageApi } = App.useApp()
    const isEdit = !!project

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
    // 不追踪 machines 等数据变化（避免表单被后台 refetch 覆盖用户输入）
    useEffect(() => {
        if (!open) return
        if (project) {
            setName(project.name)
            setMachineId(project.machineId)
            setFolders(project.folders.map(f => ({ ...f, key: nextFolderKey() })))
        } else {
            setName('')
            setMachineId(machines.length === 1 ? machines[0].id : null)
            setFolders([{ key: nextFolderKey(), path: '', primary: true }])
        }
    }, [open, project?.id])

    // 单机时隐藏机器选择器，直接取唯一值（与 NewSessionForm 单机隐藏逻辑一致）
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

    // 校验：名称 + folders 结构
    const nameError = name.trim() ? null : t('project.nameRequired')
    const foldersError = useMemo(
        () => validateProjectFolders(folders),
        [folders],
    )
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
                    patch: { name: name.trim(), folders: trimmedFolders },
                })
            } else {
                await createMutation.mutateAsync({
                    name: name.trim(),
                    machineId: machineId!,
                    folders: trimmedFolders,
                })
            }
            messageApi.success(t('common.success'))
            onClose()
        } catch {
            messageApi.error(t('common.error'))
        }
    }

    return (
        <Modal
            title={isEdit ? t('project.edit') : t('project.create')}
            open={open}
            onOk={handleOk}
            onCancel={onClose}
            confirmLoading={isPending}
            okButtonProps={{ disabled: !isValid }}
            okText={isEdit ? t('common.save') : t('project.create')}
            cancelText={t('common.cancel')}
            destroyOnClose
        >
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
                            options={machines.map(m => ({
                                value: m.id,
                                label: (
                                    <span>
                                        {getMachineTitle(m)}
                                        {m.metadata?.platform ? ` (${m.metadata.platform})` : ''}
                                    </span>
                                ),
                            }))}
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
        </Modal>
    )
}
