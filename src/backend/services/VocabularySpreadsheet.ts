import { Workbook } from 'exceljs';
import type { Worksheet } from 'exceljs';
import path from 'node:path';

import { parseCsv } from '@/backend/utils/csv';
import { normalizeCellValue } from '@/backend/utils/spreadsheet-cell';

/**
 * 词汇表导入导出的纯表格逻辑：读取、归一化解析与工作簿构建。
 *
 * 从 VocabularyService 拆出的用意：服务层只保留业务编排（仓储替换、缓存失效、
 * 片段同步），表格字节到结构化词表的转换是无依赖的纯函数，独立成模块后
 * 可单独测试，也不必让服务实现类背上 exceljs 的类型适配。
 */

/**
 * exceljs 读取 xlsx 时接受的字节容器类型。
 *
 * exceljs 的类型声明自带一个 Buffer 接口，与 Node 的 Buffer 不兼容，
 * 这里取出它的真实类型，转换只发生在调用点。
 */
type ExcelJsBuffer = Parameters<Workbook['xlsx']['load']>[0];

/**
 * 英文列的列名别名，按优先级从高到低排列。
 */
const WORD_COLUMN_ALIASES = ['英文', 'word', 'Word'];

/**
 * 释义列的列名别名，按优先级从高到低排列。
 */
const TRANSLATE_COLUMN_ALIASES = ['释义', 'translate', 'Translation'];

/**
 * 导入并归一化后的单词行。
 */
export interface ImportedWordRow {
    /** 单词（小写、已去重）。 */
    word: string;
    /** 释义；为空时为 null。 */
    translate: string | null;
    /** 创建时间（ISO 字符串）。 */
    created_at: string;
    /** 更新时间（ISO 字符串）。 */
    updated_at: string;
}

/**
 * 按列名别名顺序取第一个非空的单元格文本。
 *
 * @param row 数据行。
 * @param columnIndex 列名到列下标的映射。
 * @param aliases 列名别名。
 * @returns 命中的文本；都没有命中时返回空字符串。
 */
const pickColumnValue = (
    row: string[],
    columnIndex: Map<string, number>,
    aliases: string[],
): string => {
    for (const alias of aliases) {
        const index = columnIndex.get(alias);
        if (index === undefined) {
            continue;
        }
        const value = row[index] ?? '';
        if (value !== '') {
            return value;
        }
    }
    return '';
};

/**
 * 解析导入的表格内容并归一化为完整词表。
 *
 * 行为说明：
 * - 第一行非空的内容作为列名，其后的行作为数据行；
 * - 单词列与释义列各自支持多个列名别名（英文/word/Word、释义/translate/Translation），
 *   按别名顺序取第一个非空值；
 * - 单词统一小写归一，并以小写形式为键去重，后出现的行覆盖前面的内容，
 *   避免同一单词的大小写变体分写成两条并撞唯一约束；
 * - 英文列为空的行会被忽略；释义为空时记为 null。
 *
 * @param rows 表格内容（单元格已归一化为字符串）。
 * @returns 归一化后的完整单词列表。
 */
export const parseImportedWords = (rows: string[][]): ImportedWordRow[] => {
    const headerRow = rows.findIndex((row) => row.some((cell) => cell.trim() !== ''));
    if (headerRow < 0) {
        return [];
    }

    const columnIndex = new Map<string, number>();
    rows[headerRow].forEach((header, index) => {
        if (!columnIndex.has(header)) {
            columnIndex.set(header, index);
        }
    });

    const now = new Date().toISOString();
    const importedWords = new Map<string, { word: string; translate: string | null }>();

    for (const row of rows.slice(headerRow + 1)) {
        const english = pickColumnValue(row, columnIndex, WORD_COLUMN_ALIASES);
        if (english.trim() === '') {
            continue;
        }

        const translate = pickColumnValue(row, columnIndex, TRANSLATE_COLUMN_ALIASES).trim();
        const wordText = english.trim().toLowerCase();
        importedWords.set(wordText, {
            word: wordText,
            translate: translate === '' ? null : translate,
        });
    }

    return Array.from(importedWords.values()).map((item) => ({
        word: item.word,
        translate: item.translate,
        status: 'learning' as const,
        source: 'imported' as const,
        created_at: now,
        updated_at: now,
    }));
};

/**
 * 读取 xlsx 内容为二维字符串数组。
 *
 * 行为说明：
 * - 只读取第一个工作表。
 * - 单元格值统一归一化为字符串（富文本、公式等都要先摊平）。
 *
 * @param buffer xlsx 文件内容。
 * @returns 表格内容。
 */
export const readXlsxRows = async (buffer: Buffer): Promise<string[][]> => {
    const workbook = new Workbook();
    // exceljs 的类型声明里用的是它自己定义的 Buffer 接口，与 Node 的 Buffer 不兼容；
    // 运行时它要的其实就是字节数组，这里集中转换一次。
    await workbook.xlsx.load(buffer as unknown as ExcelJsBuffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
        throw new Error('导入失败：未找到第一个工作表');
    }

    const rows: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
        const values = row.values as unknown[];
        const cells: string[] = [];
        for (let index = 1; index < values.length; index += 1) {
            cells.push(normalizeCellValue(values[index]));
        }
        rows.push(cells);
    });

    return rows;
};

/**
 * 按扩展名选择读取方式，把表格内容读成二维字符串数组。
 *
 * @param filePath 词汇表文件路径。
 * @param buffer 文件内容。
 * @returns 表格内容。
 */
export const readSpreadsheetRows = async (filePath: string, buffer: Buffer): Promise<string[][]> => {
    if (path.extname(filePath).toLowerCase() === '.csv') {
        return parseCsv(buffer.toString('utf8'));
    }
    return readXlsxRows(buffer);
};

/**
 * 将单词列表转换为 Excel 工作表。
 *
 * @param workbook 目标工作簿。
 * @param name 工作表名称。
 * @param rows 单词数据。
 * @returns 配置好列宽的工作表。
 */
export const createVocabularyWorksheet = (
    workbook: Workbook,
    name: string,
    rows: Array<{ 英文: string; 释义: string }>,
): Worksheet => {
    const worksheet = workbook.addWorksheet(name);
    worksheet.addRow(['英文', '释义']);
    for (const row of rows) {
        worksheet.addRow([row.英文, row.释义]);
    }

    worksheet.getColumn(1).width = 25;
    worksheet.getColumn(2).width = 50;

    return worksheet;
};

/**
 * 为默认词表工作表补充恢复说明区域。
 *
 * 行为说明：
 * - 说明放在右侧独立单元格（D1），不遮挡词表正文。
 * - 单元格正文只显示简短标题，详细说明通过批注展示。
 *
 * @param worksheet 默认词表工作表。
 */
export const addDefaultVocabularyRestoreNote = (worksheet: Worksheet): void => {
    const noteCell = worksheet.getCell('D1');
    noteCell.value = '恢复说明';
    noteCell.note = {
        texts: [
            {
                text: '如果想恢复默认词表，可以把这一页的内容复制到第一个工作表“单词管理”里，然后再导入。',
            },
        ],
    };

    worksheet.getColumn(4).width = 12;
};
