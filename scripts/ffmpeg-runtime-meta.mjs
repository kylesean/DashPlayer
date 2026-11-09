/**
 * ffmpeg / ffprobe 运行时二进制的版本坐标与 SHA-256 校验和（单一事实来源）。
 *
 * 为什么必须钉死版本并校验摘要：
 * - 旧地址是浮动的（martin-riedl 的 `/redirect/latest/...`、BtbN 的 `releases/download/latest/...`），
 *   同一个 URL 随时可能指向不同内容，且下载过程不做任何完整性校验。传输截断、上游被顶替、
 *   中间人替换都会**静默**产出一个错误的二进制——而 ffmpeg/ffprobe 是运行时被直接 spawn 执行的
 *   （见 src/backend/infrastructure/media/ffmpeg/FfmpegGatewayImpl.ts），被替换的二进制等于
 *   在用户机器上执行任意代码。
 * - 现在每个平台/架构都指向**不可变**的构建坐标（martin-riedl 的日期快照目录、BtbN 的
 *   autobuild tag），并记录发布方自己公布的 SHA-256；`scripts/download.mjs` 下载后立即校验，
 *   对不上就删掉半截文件并抛错，绝不把未校验的二进制装进 lib/。
 *
 * 升级方式：只改这张表。URL 与 sha256 必须来自**同一个**不可变构建，且 sha256 要取自
 * 发布方自己的校验和文件（martin-riedl 的 `<资产>.zip.sha256`、BtbN 的 `checksums.sha256`），
 * 改版本时顺手重新核对一遍，别把新 URL 配上旧摘要。
 */

/** martin-riedl 构建服务器的文件根地址（快照构建的下载目录在 /download 下）。 */
export const MARTIN_RIEDL_DOWNLOAD_BASE = 'https://ffmpeg.martin-riedl.de/download';

/** Windows 构建的来源仓库（BtbN/FFmpeg-Builds）。 */
export const BTBN_REPOSITORY = 'BtbN/FFmpeg-Builds';

/**
 * Windows 构建的不可变 tag。
 *
 * `autobuild-<日期>-<时刻>` 是每次自动构建生成的固定 tag，其资产内容不再变化；而 BtbN 的
 * `latest` 是**移动 tag**：它的资产会被后续构建直接覆盖，拿它当下载源等于仍在用浮动地址。
 * 资产名带构建号（ffmpeg-N-128718-gb2b543c079-...），同一个 tag 下不会同名易容。
 */
export const BTBN_RELEASE_TAG = 'autobuild-2026-11-09-12-42';

/**
 * Windows 上 ffmpeg 与 ffprobe 打包在**同一个** zip 里（zip 内含 bin/ffmpeg.exe 与
 * bin/ffprobe.exe），所以两个工具共用同一份归档与同一份摘要。
 */
const BTBN_WINDOWS_ARCHIVES = {
    x64: {
        url: `https://github.com/${BTBN_REPOSITORY}/releases/download/${BTBN_RELEASE_TAG}/ffmpeg-N-128718-gb2b543c079-win64-gpl.zip`,
        sha256: '9a89dd61219d9acf3179c0a9958503f6fbc04325bb8aab256760fc5383e479d2',
    },
    arm64: {
        url: `https://github.com/${BTBN_REPOSITORY}/releases/download/${BTBN_RELEASE_TAG}/ffmpeg-N-128718-gb2b543c079-winarm64-gpl.zip`,
        sha256: '3284267e1fb053c1036a2a3f3894b241137c6a1ee0f7def6bd69dc11e72c2998',
    },
};

/**
 * 各平台/架构下 ffmpeg 与 ffprobe 的归档坐标（URL + SHA-256）。
 *
 * macOS / Linux 走 martin-riedl 的快照构建：目录名形如 `<unix时间戳>_<git describe>`，
 * 一旦发布就不再变化，因此整条 /download 路径是固定坐标。macOS Intel（amd64）的快照构建
 * 已停更，这里钉的是它最后一份快照（N-122320-g38e89fe502，2026-01-01）。
 */
export const FFMPEG_RUNTIME_ARCHIVES = {
    ffmpeg: {
        darwin: {
            arm64: {
                url: `${MARTIN_RIEDL_DOWNLOAD_BASE}/macos/arm64/1793460248_N-128220-gbea9d176f7/ffmpeg.zip`,
                sha256: '8094d88c459b6e0ab3bd69e96729485b50cb859451ba92c3779818d38d4b656d',
            },
            x64: {
                url: `${MARTIN_RIEDL_DOWNLOAD_BASE}/macos/amd64/1767299902_N-122320-g38e89fe502/ffmpeg.zip`,
                sha256: '6f0736d424b7426f8cbb7bba5c5448d94c976c138c669593b1f40ba534ed192f',
            },
        },
        linux: {
            arm64: {
                url: `${MARTIN_RIEDL_DOWNLOAD_BASE}/linux/arm64/1793453904_N-128220-gbea9d176f7/ffmpeg.zip`,
                sha256: '0a8976e6469af1e9867a45ebc1d8278061e85a0cf6ba83df3e90cc63e32e5490',
            },
            x64: {
                url: `${MARTIN_RIEDL_DOWNLOAD_BASE}/linux/amd64/1793455460_N-128220-gbea9d176f7/ffmpeg.zip`,
                sha256: '40d372a27c4f7e75a6732e9169a5485efff4d25ee727df78b4b9b559b0794d74',
            },
        },
        win32: {
            x64: BTBN_WINDOWS_ARCHIVES.x64,
            arm64: BTBN_WINDOWS_ARCHIVES.arm64,
        },
    },
    ffprobe: {
        darwin: {
            arm64: {
                url: `${MARTIN_RIEDL_DOWNLOAD_BASE}/macos/arm64/1793460248_N-128220-gbea9d176f7/ffprobe.zip`,
                sha256: '4587e2f13de2fa368067ad903def39306ba697cc07c1bb27da5753161628ce76',
            },
            x64: {
                url: `${MARTIN_RIEDL_DOWNLOAD_BASE}/macos/amd64/1767299902_N-122320-g38e89fe502/ffprobe.zip`,
                sha256: '46852ce00ae6f722ed30be269f310ea96c106a4246f2905d3147c5e02293081c',
            },
        },
        linux: {
            arm64: {
                url: `${MARTIN_RIEDL_DOWNLOAD_BASE}/linux/arm64/1793453904_N-128220-gbea9d176f7/ffprobe.zip`,
                sha256: 'a41f13606f4d93ea94a78c23c7ff28ae6be68c075cace606af5331e6a23b4603',
            },
            x64: {
                url: `${MARTIN_RIEDL_DOWNLOAD_BASE}/linux/amd64/1793455460_N-128220-gbea9d176f7/ffprobe.zip`,
                sha256: 'c7630080e1dc194811f0466460770e8fa9885452041514258ffc28d8ee16df82',
            },
        },
        win32: {
            x64: BTBN_WINDOWS_ARCHIVES.x64,
            arm64: BTBN_WINDOWS_ARCHIVES.arm64,
        },
    },
};

/**
 * 取出指定工具在指定平台/架构下的归档坐标。
 *
 * @param {string} binary 工具名（'ffmpeg' 或 'ffprobe'）。
 * @param {string} platform 目标平台（process.platform 取值）。
 * @param {string} arch 目标架构（x64 / arm64）。
 * @returns {{url: string, sha256: string} | null} 归档坐标；该平台/架构不受支持时返回 null。
 */
export const ffmpegRuntimeArchive = (binary, platform, arch) =>
    FFMPEG_RUNTIME_ARCHIVES[binary]?.[platform]?.[arch] ?? null;
