/**
 * 表格单元格值归一化。
 *
 * 背景：exceljs 对富文本单元格返回的是对象而不是字符串
 * （`{ richText: [...] }`、`{ text }`、`{ formula }` 等），
 * 直接当字符串用会拿到 `[object Object]`，导入时单词就会静默变成空。
 * 这里把单元格原始值统一收敛成纯文本。
 */

/**
 * 富文本片段。
 */
interface RichTextSegment {
    text?: string;
}

/**
 * exceljs 可能返回的单元格对象值。
 */
interface CellValueObject {
    text?: string;
    richText?: RichTextSegment[];
    formula?: string;
    sharedFormula?: string;
    result?: unknown;
    error?: string;
    hyperlink?: string;
}

/**
 * 把表格单元格值归一化为纯文本。
 *
 * 行为说明：
 * - 字符串原样返回；数字与布尔值转成字符串；
 * - `{ text }` 取其文本；`{ richText }` 拼接所有片段的文本；
 * - `{ formula }` / `{ sharedFormula }` 取计算结果（没有结果时为空串）；
 * - 空值与无法识别的结构返回空字符串。
 *
 * @param value 单元格原始值。
 * @returns 归一化后的文本。
 */
export const normalizeCellValue = (value: unknown): string => {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'object') {
        const cell = value as CellValueObject;

        if (typeof cell.text === 'string') {
            return cell.text;
        }

        if (Array.isArray(cell.richText)) {
            return cell.richText
                .map((segment) => (typeof segment?.text === 'string' ? segment.text : ''))
                .join('');
        }

        if (typeof cell.formula === 'string' || typeof cell.sharedFormula === 'string') {
            return normalizeCellValue(cell.result);
        }

        if (cell.result !== undefined) {
            return normalizeCellValue(cell.result);
        }

        if (typeof cell.error === 'string') {
            return cell.error;
        }

        if (typeof cell.hyperlink === 'string') {
            return cell.hyperlink;
        }
    }

    return '';
};
