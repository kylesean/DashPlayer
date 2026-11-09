import path from 'node:path';

/**
 * IPC 传入的文件路径校验。
 *
 * 背景：几条 IPC 路由会接收渲染进程给的文件路径并直接读盘
 * （字幕解析、词汇表导入）。这些路径最终来自用户选择，本不该是任意路径，
 * 但只要渲染层出现 XSS，任意路径就会被读出来再送回渲染层。
 *
 * 这里不试图把路径关进某个根目录——用户的视频与字幕本来就在任意位置——
 * 而是把「这条路由只该处理哪类文件」钉死：扩展名对不上就直接拒绝，
 * 让这条路由无法被用来读任意文件。
 *
 * 词汇表导入目前只接受 .xlsx 与 .csv：exceljs 读不了旧版 .xls，
 * 放行它只会换来一个读不出内容的失败。
 */

/**
 * 字幕文件允许的扩展名。
 */
const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'];

/**
 * 词汇表文件允许的扩展名。
 *
 * 说明：exceljs 只能读 .xlsx，既没有 CSV 读取器也不支持旧版 .xls（BIFF），
 * 所以这里只放行 .xlsx 与由本项目自带解析器处理的 .csv。
 */
const VOCABULARY_EXTENSIONS = ['.xlsx', '.csv'];

/**
 * 旧版 Excel（BIFF）扩展名；它已经读不了，需要单独给出可操作的提示。
 */
const LEGACY_XLS_EXTENSION = '.xls';

/**
 * 词汇表导入允许的最大体积（字节）。
 *
 * 表格解析完全在内存里做，体积无上限等于给渲染层一个内存放大器。
 */
const MAX_VOCABULARY_FILE_BYTES = 32 * 1024 * 1024;

/**
 * 校验文件路径的扩展名是否在允许列表里。
 *
 * @param filePath 待校验的路径。
 * @param allowedExtensions 允许的扩展名（小写，含点）。
 * @param label 出错信息里的业务名称。
 * @throws 扩展名不在允许列表时抛出。
 */
export const assertFileExtension = (
    filePath: string,
    allowedExtensions: string[],
    label: string,
): void => {
    const extension = path.extname(filePath).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
        throw new Error(
            `${label}只接受 ${allowedExtensions.join('、')} 文件，收到的是「${extension || '无扩展名'}」`,
        );
    }
};

/**
 * 校验字幕文件路径。
 *
 * @param filePath 字幕文件路径。
 * @throws 不是字幕文件时抛出。
 */
export const assertSubtitlePath = (filePath: string): void => {
    assertFileExtension(filePath, SUBTITLE_EXTENSIONS, '字幕文件');
};

/**
 * 校验词汇表文件路径与体积。
 *
 * @param filePath 词汇表文件路径。
 * @param sizeBytes 文件字节数；未知时传 undefined 表示跳过体积检查。
 * @throws 扩展名不合法或体积超限时抛出。
 */
export const assertVocabularyPath = (filePath: string, sizeBytes?: number): void => {
    if (path.extname(filePath).toLowerCase() === LEGACY_XLS_EXTENSION) {
        throw new Error(
            '词汇表文件只接受 .xlsx、.csv 文件；旧版 .xls 已不再支持，请在 Excel 或 WPS 中另存为 .xlsx 后再导入',
        );
    }

    assertFileExtension(filePath, VOCABULARY_EXTENSIONS, '词汇表文件');
    if (sizeBytes !== undefined && sizeBytes > MAX_VOCABULARY_FILE_BYTES) {
        throw new Error(
            `词汇表文件超过 ${Math.floor(MAX_VOCABULARY_FILE_BYTES / 1024 / 1024)} MB 上限，拒绝导入`,
        );
    }
};

/**
 * 词汇表导入允许的最大体积（字节）；导出给调用方做前置判断。
 */
export const MAX_VOCABULARY_FILE_SIZE_BYTES = MAX_VOCABULARY_FILE_BYTES;
