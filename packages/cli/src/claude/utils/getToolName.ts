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
 * Converts tool names to human-readable format for UI display
 * 
 * Handles standard Claude tools, MCP tools, and special cases to provide
 * user-friendly tool names in notifications and permission requests.
 */

// Mapping for standard Claude Code tools
const STANDARD_TOOLS: Record<string, string> = {
    // File operations
    'Read': 'Read File',
    'Write': 'Write File', 
    'Edit': 'Edit File',
    'MultiEdit': 'Edit File',
    'NotebookEdit': 'Edit Notebook',
    
    // Search and navigation
    'Glob': 'Find Files',
    'Grep': 'Search in Files',
    'LS': 'List Directory',
    
    // Command execution
    'Bash': 'Run Command',
    'BashOutput': 'Check Command Output',
    'KillBash': 'Stop Command',
    
    // Task management
    'TodoWrite': 'Update Tasks',
    'TodoRead': 'Read Tasks',
    'Task': 'Launch Agent',
    'TaskCreate': 'Create Task',
    'TaskUpdate': 'Update Task',
    'TaskList': 'List Tasks',
    'TaskGet': 'Get Task',
    'TaskOutput': 'Get Task Output',
    'TaskStop': 'Stop Task',

    // Team management
    'TeamCreate': 'Create Team',
    'TeamDelete': 'Delete Team',
    'SendMessage': 'Send Message',
    'EnterWorktree': 'Enter Worktree',

    // Web tools
    'WebFetch': 'Fetch Web Page',
    'WebSearch': 'Search Web',
    
    // Special cases
    'exit_plan_mode': 'Execute Plan',
    'ExitPlanMode': 'Execute Plan'
};

/**
 * Converts snake_case or camelCase to Title Case
 */
function toTitleCase(str: string): string {
    return str
        // Handle camelCase - insert space before uppercase letters
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        // Handle snake_case - replace underscores with spaces
        .replace(/_/g, ' ')
        // Capitalize first letter of each word
        .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Converts tool name to human-readable format
 */
export function getToolName(toolName: string): string {
    // Check if it's a standard tool
    if (STANDARD_TOOLS[toolName]) {
        return STANDARD_TOOLS[toolName];
    }
    
    // Check if it's an MCP tool (format: mcp__server__action)
    if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__');
        if (parts.length >= 3) {
            const server = toTitleCase(parts[1]);
            const action = toTitleCase(parts.slice(2).join('_'));
            return `${server}: ${action}`;
        }
    }
    
    // For unknown tools, try to make them more readable
    return toTitleCase(toolName);
}