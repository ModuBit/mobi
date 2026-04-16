/**
 * 工具文件模块声明
 * 这些文件在构建时由 Bun 嵌入
 */

declare module '*.tar.gz' {
    const path: string;
    export default path;
}

declare module '../../tools/archives/*' {
    const path: string;
    export default path;
}

declare module '../../tools/licenses/*' {
    const path: string;
    export default path;
}
