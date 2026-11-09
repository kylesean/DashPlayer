/**
 * 极简 CSV 解析器（RFC 4180 风格）。
 *
 * 背景：exceljs 只读 .xlsx，没有 CSV 读取器，而词汇表导入需要同时接受
 * 用户另存出来的 .csv。这里按 RFC 4180 实现最小可用的解析，
 * 不为此再引入一个依赖。
 *
 * 行为说明：
 * - 双引号包裹的字段按字面量解析，字段内的逗号与换行不会被当成分隔符；
 * - 字段内的 `""` 表示一个字面量引号；
 * - 同时支持 CRLF 与 LF 两种换行；
 * - 开头的 UTF-8 BOM 会被剥掉；
 * - 结尾的换行不会多产生一行空记录。
 */

/**
 * 解析 CSV 文本为二维字符串数组。
 *
 * @param content CSV 文本内容。
 * @returns 每一行一个字符串数组；空内容返回空数组。
 */
export const parseCsv = (content: string): string[][] => {
    const text = content.startsWith('\uFEFF') ? content.slice(1) : content;
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let hasContent = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];

        if (inQuotes) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    // 转义的双引号："" -> "
                    field += '"';
                    index += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
            hasContent = true;
            continue;
        }

        if (char === ',') {
            row.push(field);
            field = '';
            hasContent = true;
            continue;
        }

        if (char === '\r' || char === '\n') {
            if (char === '\r' && text[index + 1] === '\n') {
                index += 1;
            }
            row.push(field);
            field = '';
            hasContent = false;
            rows.push(row);
            row = [];
            continue;
        }

        field += char;
        hasContent = true;
    }

    // 文件末尾没有换行时补上最后一行；结尾本来就有换行时不额外产生空行。
    if (field !== '' || row.length > 0 || hasContent) {
        row.push(field);
        rows.push(row);
    }

    return rows;
};
