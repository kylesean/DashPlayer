import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { injectable } from 'inversify';
import { getMainLogger } from '@/backend/infrastructure/logger';
import { AppStateDirectoryType, getAppStatePath } from '@/backend/infrastructure/system/AppStatePath';
import { parseDictionaryTranslation } from '@/backend/utils/dictionary/parseDictionaryTranslation';
import { lemmatizeWord } from '@/backend/utils/language/VocabularyMatcher';
import type { ImportedDictionaryFormat, ImportedDictionaryVO } from '@/common/contracts/imported-dictionary';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';

/** 导入词典的注册表文件名（位于词典根目录）。 */
const REGISTRY_FILE = 'index.json';
/** 注册表结构版本。 */
const REGISTRY_SCHEMA_VERSION = 1;
/** 单个词典内部 SQLite 的文件名。 */
const DICTIONARY_DB_FILE = 'dictionary.sqlite';

/** 解析出的单条词条。 */
interface ParsedEntry {
    word: string;
    phonetic: string;
    translation: string;
}

/** 注册表磁盘形状。 */
interface DictionaryRegistry {
    schemaVersion: number;
    dictionaries: ImportedDictionaryVO[];
}

/** 内部词典查询行。 */
interface ImportedDictionaryRow {
    word: string;
    phonetic: string;
    translation: string;
}

/**
 * 解析 CSV 文本为词条列表。
 *
 * 约定列：word, phonetic, translation；首行若为表头则自动跳过。
 * 支持双引号包裹与字段内逗号/换行，双引号内 `""` 表示一个引号。
 *
 * @param content CSV 文本。
 * @returns 词条列表。
 */
export const parseCsvEntries = (content: string): ParsedEntry[] => {
    const rows = parseCsvRows(content);
    const entries: ParsedEntry[] = [];
    for (const [index, row] of rows.entries()) {
        if (row.length === 0) continue;
        const first = (row[0] ?? '').trim().toLowerCase();
        if (index === 0 && (first === 'word' || first === '单词')) continue;
        const word = (row[0] ?? '').trim();
        const phonetic = (row[1] ?? '').trim();
        const translation = (row[2] ?? '').trim();
        if (!word || !translation) continue;
        entries.push({ word, phonetic, translation });
    }
    return entries;
};

/**
 * 解析 CSV 为二维数组。
 *
 * @param content CSV 文本。
 * @returns 行数组。
 */
const parseCsvRows = (content: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        if (inQuotes) {
            if (char === '"') {
                if (content[i + 1] === '"') {
                    field += '"';
                    i += 1;
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
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (char !== '\r') {
            field += char;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
};

/** 去掉 HTML/Pango/XDFF 标记，保留可读文本。 */
const stripMarkup = (value: string): string => value
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

/**
 * 按 StarDict 类型码解码单个字段。
 *
 * @param type 类型码（m=纯文本，h=HTML，g=Pango，x=XDFF 等）。
 * @param data 字段字节。
 * @returns 可读文本；不支持的类型返回空串。
 */
const decodeStardictField = (type: string, data: Buffer): string => {
    const text = data.toString('utf8');
    if (type === 'm' || type === 'l') return text.trim();
    if (type === 'h' || type === 'g' || type === 'x') return stripMarkup(text);
    return '';
};

/**
 * 解码一条 StarDict 记录为可读文本。
 *
 * @param data 记录的原始字节。
 * @param sametypesequence ifo 声明的类型序列；为空时按记录内的类型前缀解析。
 * @returns 可读释义文本。
 */
const decodeStardictRecord = (data: Buffer, sametypesequence: string): string => {
    if (data.length === 0) return '';
    if (sametypesequence) {
        const types = sametypesequence.split('');
        const parts: string[] = [];
        let cursor = 0;
        for (let index = 0; index < types.length; index++) {
            const isLast = index === types.length - 1;
            if (isLast) {
                const text = decodeStardictField(types[index], data.subarray(cursor));
                if (text) parts.push(text);
                break;
            }
            const end = data.indexOf(0, cursor);
            const field = end < 0 ? data.subarray(cursor) : data.subarray(cursor, end);
            cursor = end < 0 ? data.length : end + 1;
            const text = decodeStardictField(types[index], field);
            if (text) parts.push(text);
        }
        return parts.join('\n');
    }

    const parts: string[] = [];
    let cursor = 0;
    while (cursor < data.length) {
        const type = String.fromCharCode(data[cursor]);
        cursor += 1;
        const end = data.indexOf(0, cursor);
        const field = end < 0 ? data.subarray(cursor) : data.subarray(cursor, end);
        cursor = end < 0 ? data.length : end + 1;
        const text = decodeStardictField(type, field);
        if (text) parts.push(text);
    }
    return parts.join('\n');
};

/**
 * 解压 gzip 文件。
 *
 * @param filePath gzip 文件路径。
 * @returns 解压后的字节。
 */
const gunzipFile = async (filePath: string): Promise<Buffer> =>
    await new Promise<Buffer>((resolve, reject) => {
        zlib.gunzip(fs.readFileSync(filePath), (error, result) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(result);
        });
    });

/**
 * 解析 StarDict 词典（.ifo + .idx/.idx.gz + .dict/.dict.dz）。
 *
 * @param ifoPath .ifo 文件路径。
 * @returns 词典名与词条列表。
 */
const parseStardict = async (ifoPath: string): Promise<{ name: string; entries: ParsedEntry[] }> => {
    const directory = path.dirname(ifoPath);
    const base = path.basename(ifoPath, path.extname(ifoPath));
    const ifo = await fs.promises.readFile(ifoPath, 'utf8');
    const meta = new Map<string, string>();
    for (const line of ifo.split(/\r?\n/u)) {
        const splitAt = line.indexOf('=');
        if (splitAt > 0) meta.set(line.slice(0, splitAt), line.slice(splitAt + 1));
    }
    const name = (meta.get('bookname') ?? base).trim() || base;
    const sametypesequence = (meta.get('sametypesequence') ?? '').trim();

    const idxPath = path.join(directory, `${base}.idx`);
    const idxBuffer = fs.existsSync(idxPath)
        ? await fs.promises.readFile(idxPath)
        : await gunzipFile(`${idxPath}.gz`);
    const dictPath = path.join(directory, `${base}.dict`);
    const dictBuffer = fs.existsSync(dictPath)
        ? await fs.promises.readFile(dictPath)
        : await gunzipFile(`${dictPath}.dz`);

    const entries: ParsedEntry[] = [];
    let cursor = 0;
    while (cursor < idxBuffer.length) {
        const wordEnd = idxBuffer.indexOf(0, cursor);
        if (wordEnd < 0) break;
        const word = idxBuffer.subarray(cursor, wordEnd).toString('utf8').trim();
        cursor = wordEnd + 1;
        if (cursor + 8 > idxBuffer.length) break;
        const offset = idxBuffer.readUInt32BE(cursor);
        cursor += 4;
        const size = idxBuffer.readUInt32BE(cursor);
        cursor += 4;
        if (!word || size <= 0 || offset + size > dictBuffer.length) continue;
        const translation = decodeStardictRecord(dictBuffer.subarray(offset, offset + size), sametypesequence).trim();
        if (!translation) continue;
        entries.push({ word, phonetic: '', translation });
    }
    return { name, entries };
};

/**
 * 解析外部 SQLite 词典。
 *
 * 约定 `entries` 表至少包含 word 与 translation 字段，phonetic 可选。
 *
 * @param dbPath SQLite 文件路径。
 * @returns 词条列表。
 */
const parseSqlite = async (dbPath: string): Promise<ParsedEntry[]> => {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        const columns = (db.prepare('PRAGMA table_info(entries)').all() as Array<{ name: string }>)
            .map((column) => column.name);
        if (columns.length === 0) {
            throw new Error('SQLite 词典缺少 entries 表');
        }
        if (!columns.includes('word') || !columns.includes('translation')) {
            throw new Error('SQLite 词典的 entries 表需要 word 与 translation 字段');
        }
        const phoneticColumn = columns.includes('phonetic') ? 'phonetic' : "'' AS phonetic";
        const rows = db.prepare(`SELECT word, ${phoneticColumn}, translation FROM entries`).all() as Array<{
            word: string;
            phonetic: string;
            translation: string;
        }>;
        return rows
            .map((row) => ({
                word: String(row.word ?? '').trim(),
                phonetic: String(row.phonetic ?? '').trim(),
                translation: String(row.translation ?? '').trim(),
            }))
            .filter((entry) => entry.word && entry.translation);
    } finally {
        db.close();
    }
};

/**
 * 用户导入词典服务。
 *
 * 只做“用户自备文件 → 应用内统一 SQLite”的转换与查询；不内置、不下载任何
 * 版权词典内容。查词时按导入顺序依次命中启用的词典。
 */
@injectable()
export default class ImportedDictionaryService {
    private readonly logger = getMainLogger('ImportedDictionaryService');
    private readonly connections = new Map<string, Database.Database>();
    private readonly statements = new Map<string, Database.Statement>();

    /** 词典根目录。 */
    private dictionaryRoot(): string {
        return getAppStatePath(AppStateDirectoryType.DICTIONARIES);
    }

    /** 读取注册表；文件缺失或损坏时视为空（不静默修复损坏内容）。 */
    private readRegistry(): DictionaryRegistry {
        const file = path.join(this.dictionaryRoot(), REGISTRY_FILE);
        if (!fs.existsSync(file)) {
            return { schemaVersion: REGISTRY_SCHEMA_VERSION, dictionaries: [] };
        }
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<DictionaryRegistry>;
        if (parsed.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.dictionaries)) {
            throw new Error(`导入词典注册表版本不匹配: ${file}`);
        }
        return { schemaVersion: REGISTRY_SCHEMA_VERSION, dictionaries: parsed.dictionaries };
    }

    /** 原子写入注册表。 */
    private writeRegistry(registry: DictionaryRegistry): void {
        const root = this.dictionaryRoot();
        fs.mkdirSync(root, { recursive: true });
        const file = path.join(root, REGISTRY_FILE);
        const temp = `${file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(registry, null, 2), 'utf8');
        fs.renameSync(temp, file);
    }

    /** 列出已导入词典。 */
    public list(): ImportedDictionaryVO[] {
        return this.readRegistry().dictionaries;
    }

    /**
     * 导入一个词典文件。
     *
     * @param filePath 用户选择的文件绝对路径。
     * @returns 新导入词典的展示信息。
     * @throws 格式不支持、文件无效或没有任何可用词条时抛出。
     */
    public async importFromFile(filePath: string): Promise<ImportedDictionaryVO> {
        const extension = path.extname(filePath).toLowerCase();
        const format = this.detectFormat(extension);
        const parsed = await this.parseByFormat(filePath, format);
        if (parsed.entries.length === 0) {
            throw new Error(`词典没有可用词条：${filePath}`);
        }

        const id = randomUUID();
        const directory = path.join(this.dictionaryRoot(), id);
        fs.mkdirSync(directory, { recursive: true });
        const targetDb = path.join(directory, DICTIONARY_DB_FILE);
        const entryCount = this.writeDictionaryDb(targetDb, parsed.entries);
        if (entryCount === 0) {
            fs.rmSync(directory, { recursive: true, force: true });
            throw new Error(`词典没有可用词条：${filePath}`);
        }

        const vo: ImportedDictionaryVO = {
            id,
            name: parsed.name,
            format,
            entryCount,
            enabled: true,
            importedAt: new Date().toISOString(),
        };
        const registry = this.readRegistry();
        registry.dictionaries.push(vo);
        this.writeRegistry(registry);
        this.logger.info('imported dictionary', { id, name: parsed.name, format, entryCount });
        return vo;
    }

    /**
     * 删除词典及其文件。
     *
     * @param id 词典 ID。
     */
    public remove(id: string): void {
        const registry = this.readRegistry();
        if (!registry.dictionaries.some((dictionary) => dictionary.id === id)) {
            return;
        }
        this.closeConnection(id);
        fs.rmSync(path.join(this.dictionaryRoot(), id), { recursive: true, force: true });
        registry.dictionaries = registry.dictionaries.filter((dictionary) => dictionary.id !== id);
        this.writeRegistry(registry);
    }

    /**
     * 启用或停用词典。
     *
     * @param id 词典 ID。
     * @param enabled 是否参与查词。
     */
    public setEnabled(id: string, enabled: boolean): void {
        const registry = this.readRegistry();
        const target = registry.dictionaries.find((dictionary) => dictionary.id === id);
        if (!target) {
            throw new Error(`词典不存在：${id}`);
        }
        target.enabled = enabled;
        this.writeRegistry(registry);
    }

    /**
     * 在全部启用的导入词典中查词（精确词形 → lemma 回退）。
     *
     * @param word 查询词。
     * @returns 命中的单词卡；全部未命中返回 null。
     */
    public lookup(word: string): OpenAIDictionaryResult | null {
        const normalized = (word ?? '').trim().toLowerCase();
        if (!normalized) return null;
        const dictionaries = this.list().filter((dictionary) => dictionary.enabled);
        for (const dictionary of dictionaries) {
            const row = this.select(dictionary.id, normalized)
                ?? this.select(dictionary.id, lemmatizeWord(normalized));
            if (!row) continue;
            const definitions = parseDictionaryTranslation(row.translation);
            if (definitions.length === 0) continue;
            return {
                word: row.word,
                phonetic: row.phonetic ?? '',
                definitions,
            };
        }
        return null;
    }

    /** 按扩展名判定格式。 */
    private detectFormat(extension: string): ImportedDictionaryFormat {
        if (extension === '.ifo') return 'stardict';
        if (extension === '.csv') return 'csv';
        if (extension === '.sqlite' || extension === '.db' || extension === '.sqlite3') return 'sqlite';
        throw new Error(`不支持的词典格式：${extension || '(无扩展名)'}。支持 StarDict(.ifo)、CSV(.csv)、SQLite(.sqlite/.db)`);
    }

    /** 按格式解析文件。 */
    private async parseByFormat(filePath: string, format: ImportedDictionaryFormat): Promise<{ name: string; entries: ParsedEntry[] }> {
        if (format === 'stardict') {
            return await parseStardict(filePath);
        }
        if (format === 'csv') {
            const content = await fs.promises.readFile(filePath, 'utf8');
            return { name: path.basename(filePath, path.extname(filePath)), entries: parseCsvEntries(content) };
        }
        return { name: path.basename(filePath, path.extname(filePath)), entries: await parseSqlite(filePath) };
    }

    /**
     * 把词条写入内部 SQLite。
     *
     * @param dbPath 目标数据库路径。
     * @param entries 词条列表。
     * @returns 实际写入的词条数（重复词形只保留首条）。
     */
    private writeDictionaryDb(dbPath: string, entries: ParsedEntry[]): number {
        fs.rmSync(dbPath, { force: true });
        const db = new Database(dbPath);
        try {
            db.exec(`
                CREATE TABLE entries (
                    word_key TEXT PRIMARY KEY,
                    word TEXT NOT NULL,
                    phonetic TEXT NOT NULL DEFAULT '',
                    translation TEXT NOT NULL
                );
            `);
            const insert = db.prepare(
                'INSERT OR IGNORE INTO entries (word_key, word, phonetic, translation) VALUES (?, ?, ?, ?)'
            );
            db.exec('BEGIN');
            for (const entry of entries) {
                const key = entry.word.trim().toLowerCase();
                if (!key || !entry.translation.trim()) continue;
                insert.run(key, entry.word.trim(), entry.phonetic, entry.translation);
            }
            db.exec('COMMIT');
            return (db.prepare('SELECT COUNT(*) AS count FROM entries').get() as { count: number }).count;
        } finally {
            db.close();
        }
    }

    /** 打开并缓存词典连接与查询语句。 */
    private select(id: string, key: string): ImportedDictionaryRow | undefined {
        let statement = this.statements.get(id);
        if (!statement) {
            const db = new Database(path.join(this.dictionaryRoot(), id, DICTIONARY_DB_FILE), {
                readonly: true,
                fileMustExist: true,
            });
            this.connections.set(id, db);
            statement = db.prepare('SELECT word, phonetic, translation FROM entries WHERE word_key = ?');
            this.statements.set(id, statement);
        }
        return statement.get(key) as ImportedDictionaryRow | undefined;
    }

    /** 关闭并移除单个词典连接。 */
    private closeConnection(id: string): void {
        this.statements.delete(id);
        const db = this.connections.get(id);
        if (db) {
            db.close();
            this.connections.delete(id);
        }
    }
}
