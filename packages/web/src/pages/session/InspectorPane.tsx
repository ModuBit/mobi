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

import { Suspense, lazy, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Layout, Button, App, Spin } from 'antd'
import { AppTooltip } from '@/ui/base/interactive/AppTooltip'
import { TabStrip, TabStripList, TabStripPanel, TabStripTab } from '@/ui/base/interactive/tabStrip'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { PanelRightClose, Folder, FileDiff, Maximize, Minimize, Plus } from 'lucide-react'
import { FileTypeBadge } from '@/ui/base/display/FileTypeBadge'
import { DropdownMenu, type DropdownItem } from '@/ui/shadcn/dropdown-menu/dropdown-menu'
import FileTreeView from '@/features/files/FileTreeView'
import FileContentView from '@/features/files/FileContentView'
import { GitReviewView } from '@/features/review/GitReviewView'
import { PAGE_HEADER_HEIGHT } from '@/features/layout/PageHeader'
import { parseTargetKey } from '@/core/lib/targetKey'

import { getEditorApi } from '@/features/files/editorRegistry'
// TerminalView 懒加载：xterm 及 addons（raw ~324K）只在首次打开终端 tab 时拉取，
// 不进会话页首载关键路径（终端为低频功能）。default export，React.lazy 直接可用
const TerminalView = lazy(() => import('@/features/terminal/TerminalView'))
import { clearCachedInstance } from '@/core/hooks/useCachedInstance'
import { InspectorEmptyState } from './InspectorEmptyState'
import { TerminalTabLabel, terminalTabName } from './TerminalTabLabel'
import { INSPECTOR_ACTIONS, type InspectorActionContext } from './inspectorActions'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import {
    useWorkspaceStore,
    type InspectorTabEntry,
    MAX_TERMINALS_PER_SESSION,
} from '@/core/data/stores/workspaceStore'

/**
 * 面板槽：撑满页签条下的剩余高度且允许内部滚动。原 antd 版靠 `&& > .ant-tabs-body-holder
 * … > .ant-tabs-tabpane` 四层类名链把 height:100% 逐层传下去；换成 flex 后同一件事由一个
 * flex 项表达。minHeight:0 不能省——内容会把链路撑开，多页 PDF / xterm 需要 bounded height
 * 才能在内部滚动，否则表现为「不能滚动 / 终端占不满」。
 */
const PanelSlot = styled(TabStripPanel)`
    flex: 1 1 auto;
    min-height: 0;
`

/** 页签条 + 面板的纵向容器（撑满检查器） */
const STRIP_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%' }

/** 页签条整条的留白：安全区上边距 + 左右 12px（原 antd tabBarStyle，数值不变）。
 *  行高与聊天页头（PageHeader）同源——两栏并排，高度不一致时分隔线与按钮中线上下错位；
 *  宽度撑满：页签可用宽度 = 行宽 − 右侧 chrome，chrome 由 TabStrip 推到行右端。
 *  页签与 chrome 的垂直居中由 TabStrip 行的 align-items 负责。 */
const STRIP_ROW_STYLE: CSSProperties = {
    padding: 'max(0px, env(safe-area-inset-top)) 12px 0',
    minHeight: PAGE_HEADER_HEIGHT,
    width: '100%',
}

export interface InspectorPaneProps {
    sessionId: string
    /** session 是否在线（CLI 已连接）；离线时 rightChrome 改浮动定位（不进 tabBar） */
    active?: boolean
}

/**
 * 审查 tab 表面（turn-diff 票06）：档位持久化挂 tab viewState——切走再切回保持
 * 上次档位；hook 须在稳定组件里调（renderTabContent 在 items map 里跑，不能内联）
 */
function ReviewTab({ sessionId, tabId }: { sessionId: string; tabId: string }) {
    const tab = useWorkspaceStore((s) => s.getSession(sessionId).tabs.find((t) => t.id === tabId))
    const target = (() => {
        const raw = tab?.viewState?.reviewTarget as string | undefined
        try {
            return raw ? parseTargetKey(raw) : { kind: 'turn' as const }
        } catch {
            return { kind: 'turn' as const }
        }
    })()
    const layout = tab?.viewState?.reviewLayout === 'split' ? 'split' : 'unified'
    const setTabViewState = useWorkspaceStore((s) => s.setTabViewState)
    return (
        <GitReviewView
            sessionId={sessionId}
            target={target}
            onTargetChange={(t) => setTabViewState(sessionId, tabId, { reviewTarget: JSON.stringify(t) })}
            layout={layout}
            onLayoutChange={(l) => setTabViewState(sessionId, tabId, { reviewLayout: l })}
        />
    )
}

export function InspectorPane({ sessionId, active = true }: InspectorPaneProps) {
    const { t } = useTranslation()
    const { modal, message } = App.useApp()
    const isMobile = useIsMobile()
    const expanded = useWorkspaceStore((s) => s.getSession(sessionId).expanded)
    const tabs = useWorkspaceStore((s) => s.getSession(sessionId).tabs)
    const activeTabId = useWorkspaceStore((s) => s.getSession(sessionId).activeTabId)
    const chatHidden = useWorkspaceStore((s) => s.getSession(sessionId).chatHidden)
    const setExpanded = useWorkspaceStore((s) => s.setExpanded)
    const setChatHidden = useWorkspaceStore((s) => s.setChatHidden)
    const openFileTreeTab = useWorkspaceStore((s) => s.openFileTreeTab)
    const openFileInTab = useWorkspaceStore((s) => s.openFileInTab)
    const closeTab = useWorkspaceStore((s) => s.closeTab)
    // 关 tab：editable 文件有未保存编辑时弹确认（保存/不保存/取消），其余直接关
    const handleCloseTab = useCallback((tabId: string) => {
        const api = getEditorApi(tabId)
        const doClose = () => closeTab(sessionId, tabId)
        if (!api?.isDirty()) {
            doClose()
            return
        }
        const instance = modal.confirm({
            title: t('files.unsavedTitle', '有未保存的修改'),
            content: t('files.unsavedBody', '关闭前是否保存？'),
            maskClosable: false,
            footer: () => (
                <>
                    <Button danger onClick={() => { instance?.destroy(); doClose() }}>
                        {t('files.discardClose', '不保存关闭')}
                    </Button>
                    <Button onClick={() => instance?.destroy()}>
                        {t('files.cancel', '取消')}
                    </Button>
                    <Button type="primary" onClick={async () => {
                        // 保存失败（冲突 / 业务错误）→ 不关 tab：避免静默丢弃用户编辑。
                        // 关掉确认框（让用户回到编辑器看 conflict/error 反馈），tab 保留，message 提示。
                        const { ok } = await api.saveNow()
                        if (!ok) {
                            instance?.destroy()
                            message.error(t('files.saveFailed', '保存失败，请处理后重试'))
                            return
                        }
                        instance?.destroy()
                        doClose()
                    }}>
                        {t('files.saveAndClose', '保存并关闭')}
                    </Button>
                </>
            ),
        })
    }, [closeTab, sessionId, t, modal, message])
    /** 关 tab 的唯一入口：终端先清缓存实例（dispose 发 terminal:close 杀 PTY + 断 socket），
     *  再走通用的关闭流程。切换 tab 不走此处，PTY 保留（keepalive）。 */
    const closeTabWithCleanup = useCallback((tab: InspectorTabEntry) => {
        if (tab.mode === 'terminal' && tab.terminalId) {
            clearCachedInstance(`terminal:${sessionId}:${tab.terminalId}`)
        }
        handleCloseTab(tab.id)
    }, [sessionId, handleCloseTab])
    const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
    const openTerminalTab = useWorkspaceStore((s) => s.openTerminalTab)
    const openReviewTab = useWorkspaceStore((s) => s.openReviewTab)
    const renameTerminalTab = useWorkspaceStore((s) => s.renameTerminalTab)
    // 终端数与上限：达上限时 disable 新建入口（叠加 INSPECTOR_ACTIONS.disabled）
    const terminalCount = tabs.filter((t) => t.mode === 'terminal').length
    const terminalLimitReached = terminalCount >= MAX_TERMINALS_PER_SESSION

    // 首次展开才挂载内容（懒加载闸）；与 destroyOnHidden={false} 分工 keepalive。
    const [everExpanded, setEverExpanded] = useState(false)
    useEffect(() => {
        if (expanded) setEverExpanded(true)
    }, [expanded])

    // chrome 簇的构造收在一处；leading 给「+」（见 InspectorChrome 注释）
    const chrome = (leading?: ReactNode) => (
        <InspectorChrome
            leading={leading}
            isMobile={isMobile}
            chatHidden={chatHidden}
            onToggleChat={(v) => setChatHidden(sessionId, v)}
            onCollapse={() => setExpanded(sessionId, false)}
            t={t}
        />
    )

    // 「+」下拉菜单：与空态卡片共用 INSPECTOR_ACTIONS（可用性与执行都在清单上）
    const actionsContext: InspectorActionContext = {
        terminalLimitReached,
        openFile: () => openFileTreeTab(sessionId),
        openTerminal: () => openTerminalTab(sessionId),
        openReview: () => openReviewTab(sessionId),
    }
    const addMenuItems: DropdownItem[] = INSPECTOR_ACTIONS.map((action) => {
        const { Icon } = action
        const disabled = action.disabled || action.enabled?.(actionsContext) === false
        return {
            key: action.key,
            icon: <Icon size={14} />,
            label: t(action.labelKey),
            disabled,
            onSelect: disabled ? undefined : () => action.run(actionsContext),
        }
    })
    // 「+」新建 tab 菜单按钮（与 rightChrome 同款 text/small，摆在它的左侧）。
    // 它是 tab 栏的附属动作，**不是 tab**——曾以「假 tab」形式挂在 label 里，但那让带 portal 的
    // 弹层落进 `role=tab` 内：重开焦点时 React 的 portal 事件沿 React 树冒泡到 tab 的 onFocus，
    // rc-tabs 据此 setFocusKey 再 focus() 抢回焦点，Radix 判为 focus-outside 立刻关闭菜单
    // （开完即关）。tabBarExtraContent 是 antd 给「tab 旁动作」的位置，也是它自带 add 按钮的落点。
    const addTabMenu = (
        <DropdownMenu
            trigger={
                <Button
                    type="text"
                    size="small"
                    icon={<Plus size={16} />}
                    aria-label={t('session.inspector.addTab')}
                />
            }
            items={addMenuItems}
        />
    )

    const renderTabContent = (tab: InspectorTabEntry): ReactNode => {
        if (tab.mode === 'file' && tab.filePath) {
            return <FileContentView sessionId={sessionId} tabId={tab.id} filePath={tab.filePath} />
        }
        if (tab.mode === 'terminal' && tab.terminalId) {
            return (
                <Suspense fallback={<div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}>
                    <TerminalView sessionId={sessionId} terminalId={tab.terminalId} />
                </Suspense>
            )
        }
        if (tab.mode === 'review') {
            // git 审查视图（turn-diff）：数据 machine 通道现查，休眠可开；档位挂 viewState 持久化
            return <ReviewTab sessionId={sessionId} tabId={tab.id} />
        }
        return (
            <FileTreeView
                sessionId={sessionId}
                active={activeTabId === tab.id}
                onOpenFile={(filePath, fileName) => openFileInTab(sessionId, tab.id, filePath, fileName)}
            />
        )
    }

    /** 页签上显示的名字。关闭按钮的无障碍名称与它同源——光一个「×」读屏读不出关的是哪个页签 */
    const tabDisplayName = (tab: InspectorTabEntry): string => {
        if (tab.mode === 'file') return tab.fileName ?? ''
        if (tab.mode === 'terminal') return terminalTabName(tab, t)
        return t(tab.mode === 'review' ? 'session.inspector.review' : 'session.inspector.openFile')
    }

    /** 页签的可见标签 = 上面那个名字 + 一枚类型图标（终端另有就地改名，整体交给 TerminalTabLabel） */
    const renderTabLabel = (tab: InspectorTabEntry): ReactNode => (
        <AppTooltip title={tab.mode === 'file' ? tab.filePath : ''}>
            {tab.mode === 'terminal' ? (
                <TerminalTabLabel
                    tab={tab}
                    onRename={(title) => renameTerminalTab(sessionId, tab.id, title)}
                />
            ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* 文件 tab 按扩展名画类型徽章（TS 色块/目录 glyph），审查与文件树各一枚固定图标 */}
                    {tab.mode === 'review' ? (
                        <FileDiff size={14} />
                    ) : tab.mode === 'file' ? (
                        <FileTypeBadge path={tab.filePath ?? ''} size={14} />
                    ) : (
                        <Folder size={14} />
                    )}
                    {tabDisplayName(tab)}
                </span>
            )}
        </AppTooltip>
    )

    const hasTabs = tabs.length > 0
    // 空态：居中 3 按钮。休眠也显示——openFile/桌面 machine 化照常可用，终端创建后
    // daemon 自动唤醒 + session_waking 重试兜底（dormancy：首动作自然变慢，无独立门控）
    const showEmpty = expanded && !hasTabs

    return (
        <Layout style={{ height: '100%', position: 'relative', paddingBottom: 'max(0px, env(safe-area-inset-bottom))' }}>
            {/* tab 内容：有 tab 时渲染。active 切换（在线↔离线）不卸载（keepMounted + 同一条件分支），
                离线时保留作毛玻璃背景，模糊可见关闭前的内容。空态/未展开不渲染（避免无谓 RPC）。 */}
            {everExpanded && hasTabs && (
                <TabStrip
                    value={activeTabId ?? ''}
                    onValueChange={(key) => {
                        setActiveTab(sessionId, key)
                    }}
                    style={STRIP_STYLE}
                >
                    {/* 在线：整簇 chrome 挂页签条右端（extra 槽在 tablist 之外，行布局由它收口）。
                        离线时 chrome 走下方浮动角，两者不重叠 */}
                    <TabStripList
                        ariaLabel={t('session.inspector.tabs')}
                        style={STRIP_ROW_STYLE}
                        extra={active ? chrome(addTabMenu) : null}
                    >
                        {tabs.map((tab) => (
                            <TabStripTab
                                key={tab.id}
                                value={tab.id}
                                closeLabel={t('session.inspector.closeTab', { name: tabDisplayName(tab) })}
                                onClose={() => closeTabWithCleanup(tab)}
                            >
                                {renderTabLabel(tab)}
                            </TabStripTab>
                        ))}
                    </TabStripList>
                    {/* keepMounted：首次展开后切走不卸载（终端不重连、文件树不回到根） */}
                    {tabs.map((tab) => (
                        <PanelSlot key={tab.id} value={tab.id} keepMounted>
                            {renderTabContent(tab)}
                        </PanelSlot>
                    ))}
                </TabStrip>
            )}
            {everExpanded && showEmpty && (
                <InspectorEmptyState actionsContext={actionsContext} />
            )}
            {/* 空态/离线态的浮动 chrome（在线 tab 态的在页签条右端的 extra 槽）。
                zIndex 高于毛玻璃，保证离线时最大化/收起按钮可点；离线且有 tab 时「+」一并在此，
                不进页签条——所以 extra 传 null，避免两处重叠 */}
            {(showEmpty || !active) && (
                /* 浮动 chrome 的盒子与页签条同形（安全区上边距 + 同高 + 垂直居中），
                   离线时它正好压在页签行的右端、空态时落在页头的同一水平带上 */
                <div style={{
                    position: 'absolute',
                    top: 0,
                    right: 8,
                    zIndex: 11,
                    paddingTop: 'max(0px, env(safe-area-inset-top))',
                    minHeight: PAGE_HEADER_HEIGHT,
                    display: 'flex',
                    alignItems: 'center',
                }}>
                    {chrome(hasTabs ? addTabMenu : undefined)}
                </div>
            )}
            {/* 终端 tab 休眠/离线时不叠 ActivateCover：TerminalView 自带重连遮罩
                （create 被拒 → session_waking 提示 + 自动重试 + 手动「重连」按钮，
                重发 create 即触发 daemon 唤醒），再盖一层恢复引导是重复门控 */}
        </Layout>
    )
}

/** 右上角 chrome 簇：leading（「+」新建 tab，仅在有 tab 时给）+ 最大化/恢复 + 收起，同一行。
 *  整簇的布局只在这里写一次——两个落点（在线 tab 栏右端 / 空态与离线的浮动角）共用，
 *  避免各自包一层 flex 时漏改（「+」被挤成独立一行就是这么来的）。 */
function InspectorChrome({
    leading,
    isMobile,
    chatHidden,
    onToggleChat,
    onCollapse,
    t,
}: {
    leading?: ReactNode
    isMobile: boolean
    chatHidden: boolean
    onToggleChat: (v: boolean) => void
    onCollapse: () => void
    t: (k: string) => string
}) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {leading}
            {!isMobile && (
                chatHidden ? (
                    <AppTooltip title={t('session.inspector.restore')}>
                        <Button type="text" size="small" icon={<Minimize size={16} />} aria-label={t('session.inspector.restore')} onClick={() => onToggleChat(false)} />
                    </AppTooltip>
                ) : (
                    <AppTooltip title={t('session.inspector.maximize')}>
                        <Button type="text" size="small" icon={<Maximize size={16} />} aria-label={t('session.inspector.maximize')} onClick={() => onToggleChat(true)} />
                    </AppTooltip>
                )
            )}
            <AppTooltip title={t('session.inspector.collapse')}>
                <Button type="text" size="small" icon={<PanelRightClose size={16} />} aria-label={t('session.inspector.collapse')} onClick={onCollapse} />
            </AppTooltip>
        </div>
    )
}
