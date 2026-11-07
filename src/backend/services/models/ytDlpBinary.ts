/**
 * yt-dlp 官方单文件二进制的钉版配置。
 *
 * YouTube 导入功能首次使用时按当前平台下载对应二进制到存储目录 bin/ 下；
 * 版本与 SHA256 逐平台钉死，保证下载内容可校验、升级需显式改这里。
 * 校验和来自官方 Release 附带的 SHA2-256SUMS（2026.10.26）。
 */
/** 钉住的 yt-dlp 版本号。 */
export const YT_DLP_VERSION = '2026.10.26';

/** 各平台对应的官方单文件二进制资产名。 */
const YT_DLP_BINARY_NAMES: Partial<Record<NodeJS.Platform, string>> = {
    linux: 'yt-dlp_linux',
    darwin: 'yt-dlp_macos',
    win32: 'yt-dlp.exe',
};

/** 各平台二进制的 SHA256，与 YT_DLP_BINARY_NAMES 一一对应。 */
const YT_DLP_BINARY_SHA256: Partial<Record<NodeJS.Platform, string>> = {
    linux: '767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795',
    darwin: '0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa',
    win32: 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d',
};

/**
 * 读取当前平台的 yt-dlp 二进制资产名。
 * @returns 资产文件名。
 * @throws {Error} 当前平台没有官方单文件二进制时抛出。
 */
export function ytDlpBinaryFileName(): string {
    const name = YT_DLP_BINARY_NAMES[process.platform];
    if (!name) {
        throw new Error(`YouTube 导入暂不支持当前平台：${process.platform}`);
    }
    return name;
}

/**
 * 读取当前平台二进制的 SHA256 校验和。
 * @returns 64 位十六进制摘要。
 */
export function ytDlpBinarySha256(): string {
    const sha256 = YT_DLP_BINARY_SHA256[process.platform];
    if (!sha256) {
        throw new Error(`YouTube 导入暂不支持当前平台：${process.platform}`);
    }
    return sha256;
}

/**
 * 生成官方 Release 下载地址（有序候选，首位优先）。
 * @returns 候选下载地址列表。
 */
export function ytDlpDownloadUrls(): string[] {
    return [`https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${ytDlpBinaryFileName()}`];
}
