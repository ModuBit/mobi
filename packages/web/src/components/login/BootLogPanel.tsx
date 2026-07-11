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
import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Logo } from '@/components/layout/Logo'
import { MobiWordmark } from '@/components/layout/MobiWordmark'
import { useThemeLocaleToggle } from '@/components/layout/useThemeLocaleToggle'
import { useBootSequence, type BootLine } from './useBootSequence'
import { useRotation } from './useRotation'

const CURRENT_YEAR = new Date().getFullYear()

/** mobi 支持的 agent runtime（当前 claude code，后续接入 codex / opencode 等） */
const RUNTIMES = ['claude code', 'codex', 'opencode'] as const
/** reach 字段轮播的设备类型（展示跨设备愿景） */
const DEVICES = ['any device', 'phone', 'tablet', 'desktop'] as const
/** CmdLine 历史命令轮播（mobi 真实命令，展示 CLI 能力） */
const COMMANDS = ['mobi service start', 'mobi setup', 'mobi doctor', 'mobi upgrade'] as const
/** tagline 轮播的 i18n key */
const TAGLINE_KEYS = ['login.subtitle', 'login.tagline2', 'login.tagline3'] as const
// 各轮播节奏错开，避免同时切换眼花
const RUNTIME_INTERVAL = 2600
const REACH_INTERVAL = 2200
const CMD_INTERVAL = 3000
const TAGLINE_INTERVAL = 4200
/** connection 进度条：8 格纯 CSS 扫动（无 JS tick，不触发组件重渲染） */
const BAR_TOTAL = 8
const BAR_SWEEP_PERIOD = 2.64 // 秒，8 格按 idx 错开 delay 形成往返扫动波

const blink = keyframes`50% { opacity: 0; }`

/** 轮播切换时的淡入 */
const fade = keyframes`
    from { opacity: 0; transform: translateY(-2px); }
    to { opacity: 1; transform: translateY(0); }
`

/** 进度条单格扫动（亮峰经过时变绿） */
const barSweep = keyframes`
    0%, 100% { color: #3a3a37; }
    50% { color: #4ade80; }
`

/** 左侧终端面板：neofetch 风仪表盘，替换原 BrandPanel，仅 PC 显示 */
const Panel = styled.div<{ $isDark: boolean }>`
    display: none;
    flex-direction: column;
    width: 50%;
    position: relative;
    overflow: hidden;
    /* 深色底 + 双角绿色辉光，营造终端氛围（非纯色） */
    background:
        radial-gradient(circle at 12% 88%, rgba(74, 222, 128, 0.08), transparent 45%),
        radial-gradient(circle at 92% 8%, rgba(74, 222, 128, 0.05), transparent 38%),
        ${({ $isDark }) => ($isDark ? '#0a0a09' : '#141413')};
    font-family: var(--font-mono);
    color: #d1cfc5;

    @media (min-width: 1024px) {
        display: flex;
    }

    /* 扫描线纹理 */
    &::before {
        content: '';
        position: absolute;
        inset: 0;
        background: repeating-linear-gradient(
            0deg,
            rgba(255, 255, 255, 0.015) 0 1px,
            transparent 1px 3px
        );
        pointer-events: none;
    }

    /* 网格点阵（中心显、边缘渐隐，聚焦内容） */
    &::after {
        content: '';
        position: absolute;
        inset: 0;
        background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px);
        background-size: 22px 22px;
        pointer-events: none;
        -webkit-mask-image: radial-gradient(ellipse at center, #000 25%, transparent 78%);
        mask-image: radial-gradient(ellipse at center, #000 25%, transparent 78%);
    }
`

/** 窗口标题栏 */
const Titlebar = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    border-bottom: 1px solid #2a2a27;
    background: rgba(255, 255, 255, 0.02);
    position: relative;
    z-index: 1;
`

const Dot = styled.span<{ $c: string }>`
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: ${({ $c }) => $c};
    flex-shrink: 0;
`

const Title = styled.span`
    margin-left: 8px;
    font-size: 11px;
    color: #6b6a65;
    letter-spacing: 0.04em;

    b {
        color: #87867f;
        font-weight: 600;
    }
`

/** 标题栏右侧在线指示 */
const TbRight = styled.span`
    margin-left: auto;
    font-size: 10px;
    color: #6b6a65;
    display: flex;
    align-items: center;
    gap: 5px;
    letter-spacing: 0.04em;
`

const TbDot = styled.span`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
    box-shadow: 0 0 6px rgba(74, 222, 128, 0.6);
`

const Body = styled.div`
    flex: 1;
    min-height: 0;
    padding: 20px 28px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: relative;
    z-index: 1;
    /* 视口高度不足时内容区滚动（Status 固定为底栏，prompt 始终可见） */
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #2a2a27 transparent;
    &::-webkit-scrollbar {
        width: 6px;
    }
    &::-webkit-scrollbar-track {
        background: transparent;
    }
    &::-webkit-scrollbar-thumb {
        background: #2a2a27;
        border-radius: 3px;
    }
    &::-webkit-scrollbar-thumb:hover {
        background: #3a3a37;
    }
`

/** 顶部 hero：m 标记 + 信息表 */
const Hero = styled.div`
    display: flex;
    gap: 22px;
    align-items: center;
`

const LogoWrap = styled.div`
    flex-shrink: 0;
    filter: drop-shadow(0 0 14px rgba(74, 222, 128, 0.12));
`

const HeroInfo = styled.div`
    flex: 1;
    min-width: 0;
`

const HeroName = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
`

const Ver = styled.span`
    font-size: 11px;
    color: #6b6a65;
    font-weight: 400;
`

const Rule = styled.div`
    height: 1px;
    background: #2a2a27;
    margin: 7px 0 8px;
`

/** neofetch 风信息表：key: value */
const InfoTable = styled.div`
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 14px;
    font-size: 12px;
    line-height: 1.7;
`

const K = styled.span`
    color: #6b6a65;
`

const V = styled.span`
    color: #faf9f5;
`

const VGreen = styled.span`
    color: #4ade80;
`

/** hero 下的 tagline 注释 */
const Tagline = styled.div`
    font-size: 12px;
    color: #87867f;
    line-height: 1.5;
`

const Comment = styled.span`
    color: #4d4c48;
`

/** 分隔线带标签 */
const Sep = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
    color: #4d4c48;
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;

    &::before {
        content: '';
        height: 1px;
        background: #2a2a27;
        flex: 0 0 8px;
    }

    &::after {
        content: '';
        height: 1px;
        background: #2a2a27;
        flex: 1;
    }
`

const Feats = styled.div`
    display: flex;
    flex-direction: column;
    gap: 8px;
`

const FeatTitle = styled.div`
    font-size: 13px;
    color: #faf9f5;
    display: flex;
    align-items: baseline;
    gap: 8px;
`

const Idx = styled.span`
    color: #4d4c48;
    font-size: 11px;
`

const Mark = styled.span`
    color: #4ade80;
`

const FeatDesc = styled.div`
    font-size: 11px;
    color: #6b6a65;
    padding-left: 42px;
    line-height: 1.5;
    margin-top: 1px;
`

/** 通用内容块（boot log / 能力树共用）：subtle 底色区分，分区语言与 Sep 统一 */
const Block = styled.div`
    display: flex;
    flex-direction: column;
    padding: 10px 12px 11px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.18);
`

/** 轮播文本：key 变化时重挂载触发淡入（runtime / reach / 命令 / 标语 / 能力树值共用） */
const FadeText = styled.span`
    display: inline-block;
    animation: ${fade} 0.35s ease;
`

/** boot log 单行：▸ msg ……… ok */
const LogRow = styled.div`
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 11px;
    line-height: 1.85;
    color: #87867f;
`

const LogArrow = styled.span`
    color: #4d4c48;
`

const LogMsg = styled.span`
    color: #d1cfc5;
`

const LogFill = styled.span`
    flex: 1;
    border-bottom: 1px dotted #3a3a37;
    transform: translateY(-3px);
    margin: 0 4px;
`

const LogOk = styled.span`
    color: #4ade80;
`

/** 能力树单行：├── name/ ……… val（终端目录树，展示 mobi 模块） */
const TreeRow = styled.div`
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 11px;
    line-height: 1.85;
    color: #6b6a65;
`

const TreeBranch = styled.span`
    color: #4d4c48;
`

const TreeName = styled.span`
    color: #4ade80;
`

const TreeFill = styled.span`
    flex: 1;
    border-bottom: 1px dotted #3a3a37;
    transform: translateY(-3px);
    margin: 0 4px;
`

const TreeVal = styled.span`
    color: #d1cfc5;
`

/** 底栏：进度条 + 历史命令 + 系统信息 + prompt（固定常驻，不随内容滚动） */
const Status = styled.div`
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 12px 28px 14px;
    border-top: 1px solid #2a2a27;
    background: rgba(0, 0, 0, 0.18);
    position: relative;
    z-index: 1;
`

const Progress = styled.div`
    font-size: 11px;
    color: #87867f;
    display: flex;
    align-items: center;
    gap: 8px;
`

/** 进度条容器：8 格 █，纯 CSS 扫动（reduced-motion 下前 2 格静态亮） */
const Bar = styled.span`
    display: inline-flex;
    gap: 1px;
    letter-spacing: 0;

    /* reduced-motion：定格前 2 格亮（静态连接指示） */
    @media (prefers-reduced-motion: reduce) {
        & > span:nth-child(-n + 2) {
            color: #4ade80;
        }
    }
`

const BarCell = styled.span<{ $idx: number }>`
    color: #3a3a37;
    animation: ${barSweep} ${BAR_SWEEP_PERIOD}s linear infinite;
    /* 8 格按 idx 错开 delay，形成从左到右的扫动波 */
    animation-delay: ${({ $idx }) => $idx * (BAR_SWEEP_PERIOD / BAR_TOTAL)}s;

    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`

/** 历史命令行（淡化，营造曾执行过的终端感） */
const CmdLine = styled.div`
    font-size: 11px;
    color: #6b6a65;
    opacity: 0.65;
`

const CmdDollar = styled.span`
    color: #4ade80;
`

const SysLine = styled.div`
    font-size: 10px;
    color: #6b6a65;
`

const PromptLine = styled.div`
    font-size: 13px;
    color: #faf9f5;
    display: flex;
    align-items: center;
    gap: 6px;
`

const Pmt = styled.span`
    color: #4ade80;
    font-weight: 700;
`

const Cursor = styled.span`
    display: inline-block;
    width: 8px;
    height: 14px;
    background: #faf9f5;
    vertical-align: -2px;
    animation: ${blink} 1s steps(2) infinite;

    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`

const Foot = styled.div`
    padding: 8px 28px 14px;
    color: #4d4c48;
    font-size: 10px;
    position: relative;
    z-index: 1;
`

/** boot log 启动序列（逐行打字机滚出，终端启动感） */
const BOOT_LOG: { msg: string }[] = [
    { msg: 'initializing mobi daemon' },
    { msg: 'loading plugin registry (24)' },
    { msg: 'mounting workspace' },
    { msg: 'pairing devices (3)' },
    { msg: 'establishing secure tunnel' },
    { msg: 'warming context cache' },
]

export function BootLogPanel() {
    const { t } = useTranslation()
    const { resolvedTheme } = useThemeLocaleToggle()
    const isDark = resolvedTheme === 'dark'

    // 循环轮播（runtime / reach / 命令 / 标语），节奏错开；reduce-motion 时各自固定首个
    const runtime = useRotation(RUNTIMES, RUNTIME_INTERVAL)
    const device = useRotation(DEVICES, REACH_INTERVAL)
    const cmd = useRotation(COMMANDS, CMD_INTERVAL)
    const taglineKey = useRotation(TAGLINE_KEYS, TAGLINE_INTERVAL)
    // workspace 数字行小幅波动（terminal / files 状态词固定）
    const sessionsVal = useRotation(['3 active', '4 active', '2 active'], 2500)
    const devicesVal = useRotation(['2 paired', '3 paired', '1 paired'], 2900)
    const pluginsVal = useRotation(['24 loaded', '26 loaded', '23 loaded'], 2300)
    // workspace 能力树：name 顺序固定，val 数字行轮播 / terminal·files 状态词固定
    const treeRows = [
        { name: 'sessions', val: sessionsVal },
        { name: 'devices', val: devicesVal },
        { name: 'terminal', val: 'live' },
        { name: 'plugins', val: pluginsVal },
        { name: 'files', val: 'synced' },
    ]

    // 打字机驱动 feature（hero / boot log / 状态行各自由 hook 驱动）
    const lines = useMemo<BootLine[]>(
        () => [
            {
                id: 'f1',
                node: (
                    <>
                        <FeatTitle>
                            <Idx>01</Idx>
                            <Mark>▸</Mark>
                            {t('login.feature1Title')}
                        </FeatTitle>
                        <FeatDesc>{t('login.feature1Desc')}</FeatDesc>
                    </>
                ),
            },
            {
                id: 'f2',
                node: (
                    <>
                        <FeatTitle>
                            <Idx>02</Idx>
                            <Mark>▸</Mark>
                            {t('login.feature2Title')}
                        </FeatTitle>
                        <FeatDesc>{t('login.feature2Desc')}</FeatDesc>
                    </>
                ),
            },
            {
                id: 'f3',
                node: (
                    <>
                        <FeatTitle>
                            <Idx>03</Idx>
                            <Mark>▸</Mark>
                            {t('login.feature3Title')}
                        </FeatTitle>
                        <FeatDesc>{t('login.feature3Desc')}</FeatDesc>
                    </>
                ),
            },
        ],
        [t],
    )
    const { visibleCount } = useBootSequence(lines, 200)

    // boot log 逐行打字机滚出（终端启动日志一行行出现）
    const bootLines = useMemo<BootLine[]>(
        () =>
            BOOT_LOG.map((l, i) => ({
                id: `b${i}`,
                node: (
                    <LogRow>
                        <LogArrow>▸</LogArrow>
                        <LogMsg>{l.msg}</LogMsg>
                        <LogFill />
                        <LogOk>ok</LogOk>
                    </LogRow>
                ),
            })),
        [],
    )
    const { visibleCount: bootVisible } = useBootSequence(bootLines, 180)

    return (
        <Panel $isDark={isDark}>
            <Titlebar>
                <Dot $c="#ff5f57" />
                <Dot $c="#febc2e" />
                <Dot $c="#28c840" />
                <Title>
                    <b>mobi</b> — boot sequence
                </Title>
                <TbRight>
                    <TbDot />
                    online
                </TbRight>
            </Titlebar>
            <Body>
                <Hero>
                    <LogoWrap>
                        <Logo color="#faf9f5" style={{ width: 58, height: 58 }} />
                    </LogoWrap>
                    <HeroInfo>
                        <HeroName>
                            <MobiWordmark size={26} color="#faf9f5" />
                            <Ver>{`v${__MOBI_VERSION__}`}</Ver>
                        </HeroName>
                        <Rule />
                        <InfoTable>
                            <K>status</K>
                            <VGreen>● ready</VGreen>
                            <K>runtime</K>
                            <V>
                                <FadeText key={runtime}>{runtime}</FadeText>
                            </V>
                            <K>version</K>
                            <V>{__MOBI_VERSION__}</V>
                            <K>reach</K>
                            <V>
                                <FadeText key={device}>{device}</FadeText>
                            </V>
                            <K>privacy</K>
                            <V>100% local</V>
                            <K>uptime</K>
                            <V>∞</V>
                        </InfoTable>
                    </HeroInfo>
                </Hero>

                <Sep>{'boot log'}</Sep>
                <Block>
                    {bootLines.slice(0, bootVisible).map((l) => (
                        <div key={l.id}>{l.node}</div>
                    ))}
                </Block>

                <Tagline>
                    <Comment>#</Comment>{' '}
                    <FadeText key={taglineKey}>{t(taglineKey)}</FadeText>
                </Tagline>

                <Sep>{t('login.whatYouCanDo')}</Sep>

                <Feats>
                    {lines.slice(0, visibleCount).map((l) => (
                        <div key={l.id}>{l.node}</div>
                    ))}
                </Feats>

                <Sep>{'workspace'}</Sep>
                <Block>
                    {treeRows.map(({ name, val }, i) => (
                        <TreeRow key={name}>
                            <TreeBranch>{i === treeRows.length - 1 ? '└──' : '├──'}</TreeBranch>
                            <TreeName>{name}/</TreeName>
                            <TreeFill />
                            <TreeVal>
                                <FadeText key={`${name}-${val}`}>{val}</FadeText>
                            </TreeVal>
                        </TreeRow>
                    ))}
                </Block>
            </Body>

            <Status>
                <Progress>
                    connection{' '}
                    <Bar>
                        {Array.from({ length: BAR_TOTAL }, (_, i) => (
                            <BarCell key={i} $idx={i}>
                                █
                            </BarCell>
                        ))}
                    </Bar>{' '}
                    idle
                </Progress>
                <CmdLine>
                    <CmdDollar>$</CmdDollar> <FadeText key={cmd}>{cmd}</FadeText>
                </CmdLine>
                <SysLine>
                    mobi/{__MOBI_VERSION__} ·{' '}
                    <FadeText key={`sys-${runtime}`}>{runtime}</FadeText> ·{' '}
                    <VGreen>ready</VGreen>
                </SysLine>
                <PromptLine>
                    <Pmt>{'>'}</Pmt>
                    awaiting token
                    <Cursor />
                </PromptLine>
            </Status>
            <Foot>{`# © ${CURRENT_YEAR} mobi`}</Foot>
        </Panel>
    )
}
