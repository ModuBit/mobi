/**
 * 类型声明文件 - 用于类型检查
 * 实际实现由 embeddedAssets.bun.ts 或 embeddedAssets.stub.ts 提供
 */

export interface EmbeddedAsset {
    relativePath: string;
    sourcePath: string;
}

export function loadEmbeddedAssets(): Promise<EmbeddedAsset[]>;
