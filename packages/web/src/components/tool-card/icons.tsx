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

import {
    CodeOutlined,
    SearchOutlined,
    EyeOutlined,
    FileTextOutlined,
    EditOutlined,
    GlobalOutlined,
    BulbOutlined,
    RocketOutlined,
    ToolOutlined,
    QuestionCircleOutlined,
    TeamOutlined,
    MessageOutlined,
    AppstoreOutlined
} from '@ant-design/icons'

type IconProps = {
    className?: string
    style?: React.CSSProperties
}

export function TerminalIcon(props: IconProps) {
    return <CodeOutlined {...props} />
}

export function SearchIcon(props: IconProps) {
    return <SearchOutlined {...props} />
}

export function EyeIcon(props: IconProps) {
    return <EyeOutlined {...props} />
}

export function FileDiffIcon(props: IconProps) {
    return <EditOutlined {...props} />
}

export function GlobeIcon(props: IconProps) {
    return <GlobalOutlined {...props} />
}

export function ClipboardIcon(props: IconProps) {
    return <FileTextOutlined {...props} />
}

export function BulbIcon(props: IconProps) {
    return <BulbOutlined {...props} />
}

export function PuzzleIcon(props: IconProps) {
    return <AppstoreOutlined {...props} />
}

export function RocketIcon(props: IconProps) {
    return <RocketOutlined {...props} />
}

export function WrenchIcon(props: IconProps) {
    return <ToolOutlined {...props} />
}

export function QuestionIcon(props: IconProps) {
    return <QuestionCircleOutlined {...props} />
}

export function UsersIcon(props: IconProps) {
    return <TeamOutlined {...props} />
}

export function MessageSquareIcon(props: IconProps) {
    return <MessageOutlined {...props} />
}
