import type { OpenAIDictionaryDefinition } from '@/common/types/DictionaryResult';

/**
 * 将多行中文释义拆成单词卡释义列表。
 *
 * 行为说明：
 * - 每行形如 "n. 取消" / "vt. 删去"，识别行首小写词性前缀（如 n./vt./adj.）后拆分为词性与释义；
 * - 识别不到词性前缀的行（如 "[计] 作废"）词性留空，释义整行保留；
 * - 空行直接丢弃。
 *
 * 预置词典与用户导入词典共用这一套拆分规则，保证单词卡形状一致。
 *
 * @param translation 多行中文释义原文。
 * @returns 单词卡释义列表；输入为空时返回空数组。
 */
export const parseDictionaryTranslation = (translation: string): OpenAIDictionaryDefinition[] => {
    const definitions: OpenAIDictionaryDefinition[] = [];
    for (const rawLine of translation.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line) continue;

        const match = line.match(/^([a-z]{1,8}\.)\s*(.+)$/u);
        if (match) {
            definitions.push({ partOfSpeech: match[1], meaning: match[2].trim(), examples: [] });
        } else {
            definitions.push({ partOfSpeech: '', meaning: line, examples: [] });
        }
    }
    return definitions;
};
