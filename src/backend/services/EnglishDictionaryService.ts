import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import type { ClientRequest } from 'node:http';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-fs';
import Database from 'better-sqlite3';
import { inject, injectable } from 'inversify';
import { getMainLogger } from '@/backend/infrastructure/logger';
import { AppStateDirectoryType, getAppStatePath } from '@/backend/infrastructure/system/AppStatePath';
import TYPES from '@/backend/ioc/types';
import type DpTaskService from '@/backend/services/DpTaskService';
import { CancelByUserError } from '@/backend/utils/errors/errors';
import { lemmatizeWord } from '@/backend/utils/language/VocabularyMatcher';
import { DpTaskState } from '@/common/contracts/dp-task';
import type { EnglishDictionarySense, EnglishDictionaryStatusVO } from '@/common/contracts/english-dictionary';

/** WordNet 3.1 归档地址（Princeton 官方，稳定版本）。 */
const SOURCE_URL = 'https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz';
/** 归档 sha256，下载后强校验。 */
const SOURCE_SHA256 = '3f7d8be8ef6ecc7167d39b10d66954ec734280b5bdcd57f7d9eafe429d11c22a';
/** 归档字节数。 */
const SOURCE_BYTES = 16358468;
/** 增强包安装目录名（位于 userData/dictionaries 下）。 */
const INSTALL_DIRECTORY = 'oewn-english';
/** 构建出的 SQLite 文件名。 */
const DB_FILE = 'english.sqlite';
/** 安装完成标记文件。 */
const MARKER_FILE = '.complete';

/** WordNet 数据文件与词性映射。 */
const DATA_FILES: ReadonlyArray<{ file: string; pos: string }> = [
    { file: 'data.noun', pos: 'noun' },
    { file: 'data.verb', pos: 'verb' },
    { file: 'data.adj', pos: 'adj' },
    { file: 'data.adv', pos: 'adv' },
];

/** 单行 data.* 的解析结果。 */
interface ParsedSynsetLine {
    key: string;
    pos: string;
    gloss: string;
    examples: string[];
    lemmas: string[];
}

/** 待解析的反义词指针。 */
interface PendingAntonym {
    sourceKey: string;
    sourceIndex: number;
    targetKey: string;
    targetIndex: number;
}

/** SQLite 查询行。 */
interface SenseRow {
    synset_key: string;
    pos: string;
    gloss: string;
    examples: string;
}

/**
 * 英英释义增强包服务。
 *
 * 数据源为 Princeton WordNet 3.1（WordNet License），仅在用户主动下载后
 * 解压并构建为本地 SQLite；不随主安装包分发。查询结果附加到单词卡。
 */
@injectable()
export default class EnglishDictionaryService {
    private readonly logger = getMainLogger('EnglishDictionaryService');
    private downloading = false;
    private downloadedBytes = 0;
    private lastError: string | null = null;
    private activeRequest: ClientRequest | null = null;
    private activeTaskId: number | null = null;
    private readonly cancelledTasks = new Set<number>();
    private db: Database.Database | null = null;
    private senseStmt: Database.Statement | null = null;
    private synonymStmt: Database.Statement | null = null;
    private antonymStmt: Database.Statement | null = null;

    constructor(
        @inject(TYPES.DpTaskService) private readonly dpTaskService: DpTaskService,
    ) {}

    /** 当前安装/下载状态。 */
    public status(): EnglishDictionaryStatusVO {
        return {
            installed: this.isInstalled(),
            downloading: this.downloading,
            downloadedBytes: this.downloadedBytes,
            totalBytes: SOURCE_BYTES,
            error: this.lastError,
        };
    }

    /**
     * 启动安装任务：下载归档 → 解压 → 构建 SQLite。
     *
     * @returns 后台任务 ID。
     * @throws 已安装或正在下载时抛出。
     */
    public async install(): Promise<number> {
        if (this.isInstalled()) {
            throw new Error('英英释义包已安装');
        }
        if (this.downloading) {
            throw new Error('英英释义包正在下载');
        }
        const taskId = await this.dpTaskService.create();
        this.downloading = true;
        this.downloadedBytes = 0;
        this.lastError = null;
        this.activeTaskId = taskId;
        this.dpTaskService.registerTask(taskId, {
            cancel: () => {
                if (this.activeTaskId === taskId) {
                    this.cancelledTasks.add(taskId);
                    this.abortActiveRequest(new Error('cancelled'));
                }
            },
        });
        void this.run(taskId);
        return taskId;
    }

    /**
     * 取消安装任务。
     *
     * @param taskId 后台任务 ID。
     */
    public cancel(taskId: number): void {
        if (this.activeTaskId !== taskId) {
            return;
        }
        this.cancelledTasks.add(taskId);
        this.dpTaskService.cancel(taskId);
        this.abortActiveRequest(new Error('cancelled'));
    }

    /** 删除已安装的增强包。 */
    public remove(): void {
        this.closeDb();
        fs.rmSync(path.join(this.installRoot(), INSTALL_DIRECTORY), { recursive: true, force: true });
        this.downloadedBytes = 0;
        this.lastError = null;
    }

    /**
     * 查询单词的英英释义（含同义/反义）。
     *
     * @param word 查询词。
     * @returns 释义列表；未安装或未命中返回 null。
     */
    public lookup(word: string): EnglishDictionarySense[] | null {
        if (!this.isInstalled()) {
            return null;
        }
        const normalized = (word ?? '').trim().toLowerCase();
        if (!normalized) return null;
        try {
            this.openDb();
            const rows = (this.senseStmt!.all(normalized) as SenseRow[]);
            const usedRows = rows.length > 0
                ? rows
                : (this.senseStmt!.all(lemmatizeWord(normalized)) as SenseRow[]);
            if (usedRows.length === 0) return null;
            return usedRows.slice(0, 8).map((row) => ({
                partOfSpeech: row.pos,
                definition: row.gloss,
                examples: JSON.parse(row.examples) as string[],
                synonyms: (this.synonymStmt!.all(row.synset_key, normalized) as Array<{ lemma: string }>)
                    .map((item) => item.lemma),
                antonyms: (this.antonymStmt!.all(normalized) as Array<{ antonym: string }>)
                    .map((item) => item.antonym),
            }));
        } catch (error) {
            this.logger.warn('english dictionary lookup failed', { word, error });
            return null;
        }
    }

    /** 安装目录根。 */
    private installRoot(): string {
        return getAppStatePath(AppStateDirectoryType.DICTIONARIES);
    }

    /** 是否已安装。 */
    private isInstalled(): boolean {
        const root = path.join(this.installRoot(), INSTALL_DIRECTORY);
        return fs.existsSync(path.join(root, MARKER_FILE))
            && fs.existsSync(path.join(root, DB_FILE));
    }

    /** 终止当前下载请求。 */
    private abortActiveRequest(error: Error): void {
        this.activeRequest?.destroy(error);
        this.activeRequest = null;
    }

    /** 安装任务主体。 */
    private async run(taskId: number): Promise<void> {
        const tempDir = path.join(this.installRoot(), `tmp-${taskId}`);
        try {
            fs.mkdirSync(tempDir, { recursive: true });
            const archivePath = path.join(tempDir, 'wordnet.tar.gz');
            this.dpTaskService.process(taskId, { progress: '下载 WordNet 3.1…' });
            await this.download(taskId, archivePath);
            this.dpTaskService.checkCancel(taskId);

            const actualSha256 = await this.sha256(archivePath);
            if (actualSha256 !== SOURCE_SHA256) {
                throw new Error(`WordNet 归档 sha256 不匹配：${actualSha256}`);
            }

            this.dpTaskService.process(taskId, { progress: '解压 WordNet 数据…' });
            const extractDir = path.join(tempDir, 'extract');
            fs.mkdirSync(extractDir, { recursive: true });
            await pipeline(
                fs.createReadStream(archivePath),
                zlib.createGunzip(),
                tar.extract(extractDir),
            );
            this.dpTaskService.checkCancel(taskId);

            const dictDir = path.join(extractDir, 'dict');
            if (!fs.existsSync(dictDir)) {
                throw new Error('WordNet 归档缺少 dict 目录');
            }

            const targetDir = path.join(this.installRoot(), INSTALL_DIRECTORY);
            fs.mkdirSync(targetDir, { recursive: true });
            const dbPath = path.join(targetDir, DB_FILE);
            this.dpTaskService.process(taskId, { progress: '构建本地词典…' });
            this.buildDatabase(taskId, dictDir, dbPath);
            fs.writeFileSync(path.join(targetDir, MARKER_FILE), new Date().toISOString(), 'utf8');

            this.dpTaskService.finish(taskId, { progress: '英英释义包安装完成', result: targetDir });
            this.logger.info('english dictionary installed', { dbPath });
        } catch (error) {
            if (error instanceof CancelByUserError || this.cancelledTasks.has(taskId)) {
                this.dpTaskService.update({ id: taskId, status: DpTaskState.CANCELLED, progress: '任务取消' });
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.lastError = message;
            this.logger.error('english dictionary install failed', { taskId, error: message });
            this.dpTaskService.fail(taskId, { progress: '英英释义包安装失败', result: message });
        } finally {
            this.downloading = false;
            this.activeRequest = null;
            this.activeTaskId = null;
            this.cancelledTasks.delete(taskId);
            try {
                await fs.promises.rm(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                this.logger.warn('english dictionary temp cleanup failed', { taskId, error: cleanupError });
            }
        }
    }

    /** 下载归档并回报进度。 */
    private download(taskId: number, dest: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = (url: string, redirects: number): void => {
                if (redirects > 5) {
                    reject(new Error('下载重定向次数过多'));
                    return;
                }
                const req = https.get(url, { headers: { 'User-Agent': 'DashPlayer-dictionary-enhancement' } }, (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        res.resume();
                        request(new URL(res.headers.location, url).toString(), redirects + 1);
                        return;
                    }
                    if (res.statusCode !== 200) {
                        res.resume();
                        reject(new Error(`下载失败 HTTP ${res.statusCode}`));
                        return;
                    }
                    const total = Number(res.headers['content-length'] ?? 0) || SOURCE_BYTES;
                    let received = 0;
                    let lastPercent = -1;
                    const out = fs.createWriteStream(dest);
                    res.on('data', (chunk: Buffer) => {
                        received += chunk.length;
                        this.downloadedBytes = received;
                        const percent = Math.min(99, Math.floor((received / total) * 100));
                        if (percent !== lastPercent) {
                            lastPercent = percent;
                            this.dpTaskService.process(taskId, { progress: `下载中 ${percent}%` });
                        }
                    });
                    res.pipe(out);
                    out.on('finish', () => resolve());
                    out.on('error', reject);
                    res.on('error', reject);
                });
                this.activeRequest = req;
                req.on('error', reject);
            };
            request(SOURCE_URL, 0);
        });
    }

    /** 计算文件 sha256。 */
    private sha256(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = createHash('sha256');
            fs.createReadStream(filePath)
                .on('error', reject)
                .on('data', (chunk) => hash.update(chunk))
                .on('end', () => resolve(hash.digest('hex')));
        });
    }

    /**
     * 解析 WordNet data.* 文件并写入 SQLite。
     *
     * @param taskId 后台任务 ID（用于取消检查）。
     * @param dictDir 解压后的 dict 目录。
     * @param dbPath 目标 SQLite 路径。
     */
    private buildDatabase(taskId: number, dictDir: string, dbPath: string): void {
        fs.rmSync(dbPath, { force: true });
        const db = new Database(dbPath);
        const synsetWords = new Map<string, string[]>();
        const pendingAntonyms: PendingAntonym[] = [];
        try {
            db.exec(`
                CREATE TABLE synsets (
                    synset_key TEXT PRIMARY KEY,
                    pos TEXT NOT NULL,
                    gloss TEXT NOT NULL,
                    examples TEXT NOT NULL DEFAULT '[]'
                );
                CREATE TABLE senses (
                    word_key TEXT NOT NULL,
                    synset_key TEXT NOT NULL,
                    lemma TEXT NOT NULL,
                    PRIMARY KEY (word_key, synset_key)
                );
                CREATE INDEX idx_senses_word ON senses(word_key);
                CREATE TABLE antonyms (
                    word_key TEXT NOT NULL,
                    antonym TEXT NOT NULL,
                    PRIMARY KEY (word_key, antonym)
                );
                CREATE INDEX idx_antonyms_word ON antonyms(word_key);
            `);
            const insertSynset = db.prepare(
                'INSERT OR REPLACE INTO synsets (synset_key, pos, gloss, examples) VALUES (?, ?, ?, ?)'
            );
            const insertSense = db.prepare(
                'INSERT OR IGNORE INTO senses (word_key, synset_key, lemma) VALUES (?, ?, ?)'
            );
            const insertAntonym = db.prepare(
                'INSERT OR IGNORE INTO antonyms (word_key, antonym) VALUES (?, ?)'
            );

            db.exec('BEGIN');
            for (const { file, pos } of DATA_FILES) {
                const filePath = path.join(dictDir, file);
                if (!fs.existsSync(filePath)) {
                    throw new Error(`WordNet 数据文件缺失：${file}`);
                }
                const content = fs.readFileSync(filePath, 'utf8');
                for (const line of content.split('\n')) {
                    const parsed = parseSynsetLine(line, pos, synsetWords, pendingAntonyms);
                    if (!parsed) continue;
                    insertSynset.run(parsed.key, parsed.pos, parsed.gloss, JSON.stringify(parsed.examples));
                    for (const lemma of parsed.lemmas) {
                        insertSense.run(lemma.toLowerCase(), parsed.key, lemma);
                    }
                }
                this.dpTaskService.checkCancel(taskId);
                this.dpTaskService.process(taskId, { progress: `解析 ${file}…` });
            }

            for (const pointer of pendingAntonyms) {
                const source = synsetWords.get(pointer.sourceKey)?.[pointer.sourceIndex];
                const target = synsetWords.get(pointer.targetKey)?.[pointer.targetIndex];
                if (source && target) {
                    insertAntonym.run(source.toLowerCase(), target);
                }
            }
            db.exec('COMMIT');
        } finally {
            db.close();
        }
    }

    /** 打开查询连接与预编译语句。 */
    private openDb(): void {
        if (this.db) return;
        const dbPath = path.join(this.installRoot(), INSTALL_DIRECTORY, DB_FILE);
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        this.db = db;
        this.senseStmt = db.prepare(`
            SELECT se.synset_key, s.pos, s.gloss, s.examples
            FROM senses se
            JOIN synsets s ON s.synset_key = se.synset_key
            WHERE se.word_key = ?
            LIMIT 8
        `);
        this.synonymStmt = db.prepare(
            'SELECT lemma FROM senses WHERE synset_key = ? AND word_key != ? LIMIT 8'
        );
        this.antonymStmt = db.prepare('SELECT antonym FROM antonyms WHERE word_key = ? LIMIT 8');
    }

    /** 关闭查询连接。 */
    private closeDb(): void {
        this.senseStmt = null;
        this.synonymStmt = null;
        this.antonymStmt = null;
        this.db?.close();
        this.db = null;
    }
}

/** 把 WordNet 的 ss_type 映射为展示用词性。 */
const mapPos = (ssType: string): string => {
    if (ssType === 'n') return 'noun';
    if (ssType === 'v') return 'verb';
    if (ssType === 'a' || ssType === 's') return 'adj';
    if (ssType === 'r') return 'adv';
    return ssType;
};

/**
 * 解析一条 WordNet data.* 记录。
 *
 * 行格式：offset lex_filenum ss_type w_cnt (word lex_id)* p_cnt
 *         (pointer_symbol target_offset target_pos source_target)* | gloss
 *
 * @param raw 原始行。
 * @param defaultPos 当前文件对应的词性。
 * @param synsetWords 全局 synset → lemma 映射（用于反义词解析）。
 * @param pendingAntonyms 收集待解析的反义词指针。
 * @returns 解析结果；表头/空行返回 null。
 */
const parseSynsetLine = (
    raw: string,
    defaultPos: string,
    synsetWords: Map<string, string[]>,
    pendingAntonyms: PendingAntonym[],
): ParsedSynsetLine | null => {
    const line = raw.trim();
    if (!/^\d{8}\s/u.test(line)) return null;
    const barIndex = line.indexOf(' | ');
    if (barIndex < 0) return null;
    const left = line.slice(0, barIndex).trim();
    const glossPart = line.slice(barIndex + 3).trim();
    const tokens = left.split(/\s+/u);

    let cursor = 0;
    const offset = tokens[cursor++];
    cursor += 1; // lex_filenum
    const ssType = tokens[cursor++];
    const wordCount = Number(tokens[cursor++]);
    if (!Number.isInteger(wordCount) || wordCount < 0) return null;

    const lemmas: string[] = [];
    for (let index = 0; index < wordCount; index++) {
        const word = tokens[cursor++];
        cursor += 1; // lex_id
        if (!word) return null;
        lemmas.push(word.replaceAll('_', ' '));
    }

    const pos = mapPos(ssType) || defaultPos;
    const key = `${pos}:${offset}`;
    synsetWords.set(key, lemmas);

    const pointerCount = Number(tokens[cursor++]);
    for (let index = 0; index < pointerCount; index++) {
        const symbol = tokens[cursor++];
        const targetOffset = tokens[cursor++];
        const targetPosToken = tokens[cursor++];
        const sourceTarget = tokens[cursor++];
        if (symbol !== '!' || !targetOffset || !sourceTarget || sourceTarget.length !== 4) continue;
        const sourceIndex = Number(sourceTarget.slice(0, 2)) - 1;
        const targetIndex = Number(sourceTarget.slice(2, 4)) - 1;
        if (sourceIndex < 0 || targetIndex < 0) continue;
        pendingAntonyms.push({
            sourceKey: key,
            sourceIndex,
            targetKey: `${mapPos(targetPosToken)}:${targetOffset}`,
            targetIndex,
        });
    }

    const firstExample = glossPart.indexOf('; "');
    const definition = (firstExample >= 0 ? glossPart.slice(0, firstExample) : glossPart).trim();
    if (!definition) return null;
    const examples = [...glossPart.matchAll(/"([^"]*)"/gu)].map((match) => match[1]);

    return { key, pos, gloss: definition, examples, lemmas };
};
