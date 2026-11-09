#!/usr/bin/env node
/**
 * 下载并生成本地主题字体（latin / latin-ext 子集）。
 *
 * 为什么自托管：产品用户主要在中国大陆，运行时 @import Google Fonts
 * 可能超时或被阻断，主题字体会静默回落成系统字体。字体文件与 OFL 授权
 * 一起提交进仓库，构建与运行都不再依赖外网。
 *
 * 只在新增/调整主题字体时手动运行：
 *   node scripts/download-fonts.mjs
 *
 * 产物：
 * - src/fronted/styles/fonts/<family>/<subset>-<n>.woff2
 * - src/fronted/styles/fonts/<family>/OFL.txt
 * - src/fronted/styles/fonts.css
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const stylesDir = path.join(projectRoot, 'src/fronted/styles');
const outRoot = path.join(stylesDir, 'fonts');
const cssFile = path.join(stylesDir, 'fonts.css');

/** 主题里出现的全部字体族；query 是 Google Fonts CSS2 的 family 参数。 */
const FAMILIES = [
    { slug: 'figtree', family: 'Figtree', query: 'Figtree:wght@400..700' },
    { slug: 'montserrat', family: 'Montserrat', query: 'Montserrat:wght@400..700' },
    { slug: 'fustat', family: 'Fustat', query: 'Fustat:wght@400..700' },
    { slug: 'dm-sans', family: 'DM Sans', query: 'DM+Sans:opsz,wght@9..40,400..700' },
    { slug: 'playwrite-us-trad', family: 'Playwrite US Trad', query: 'Playwrite+US+Trad:wght@100..400' },
    { slug: 'poppins', family: 'Poppins', query: 'Poppins:wght@400;500;600;700' },
    { slug: 'outfit', family: 'Outfit', query: 'Outfit:wght@400..700' },
    { slug: 'sarina', family: 'Sarina', query: 'Sarina' },
    { slug: 'albert-sans', family: 'Albert Sans', query: 'Albert+Sans:wght@400..700' },
    { slug: 'fraunces', family: 'Fraunces', query: 'Fraunces:opsz,wght@9..144,400..700' },
    { slug: 'jetbrains-mono', family: 'JetBrains Mono', query: 'JetBrains+Mono:wght@400..700' },
    { slug: 'crimson-text', family: 'Crimson Text', query: 'Crimson+Text:wght@400;600;700' },
    { slug: 'manufacturing-consent', family: 'Manufacturing Consent', query: 'Manufacturing+Consent' },
    { slug: 'unifrakturmaguntia', family: 'UnifrakturMaguntia', query: 'UnifrakturMaguntia' },
];

/** 只保留拉丁字符集；中文走系统字体回退，不打包体积巨大的 CJK 字体。 */
const KEEP_SUBSETS = new Set(['latin', 'latin-ext', 'fallback']);

/** 用桌面 Chrome 的 UA 请求，Google 会返回 woff2 与字体变量轴。 */
const USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

/**
 * 从 Google Fonts CSS 中解析每个 @font-face 的 subset / 字重 / 地址 / unicode-range。
 *
 * @param {string} css Google Fonts 返回的样式表。
 * @returns {{family: string, weight: string, url: string, range?: string, subset: string}[]} 字体面列表。
 */
function parseFaces(css) {
    const re = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]+)\}/g;
    const faces = [];
    let match;
    while ((match = re.exec(css)) !== null) {
        const [, subset, body] = match;
        const family = body.match(/font-family:\s*'([^']+)'/)?.[1];
        const weight = body.match(/font-weight:\s*([^;]+);/)?.[1]?.trim();
        const url = body.match(/src:\s*url\(([^)]+)\)/)?.[1];
        const range = body.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
        if (family && weight && url) {
            faces.push({ family, weight, url, range, subset });
        }
    }
    return faces;
}

/**
 * 下载单个文件到目标路径。
 *
 * @param {string} url 源地址。
 * @param {string} dest 目标路径。
 * @returns {Promise<void>} 下载完成后结束。
 */
async function download(url, dest) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`下载失败 ${url} ${response.status}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

/**
 * 下载字体授权文件（OFL 或 Apache）。
 *
 * @param {string} slug Google Fonts 仓库里的目录名（无连字符）。
 * @param {string} dir 字体目录。
 * @returns {Promise<string | null>} 找到的授权文件路径；没找到时为 null。
 */
async function downloadLicense(slug, dir) {
    for (const [branch, name] of [['ofl', 'OFL.txt'], ['apache', 'LICENSE.txt']]) {
        const response = await fetch(`https://raw.githubusercontent.com/google/fonts/main/${branch}/${slug}/${name}`);
        if (response.ok) {
            fs.writeFileSync(path.join(dir, name), await response.text());
            return `${branch}/${name}`;
        }
    }
    return null;
}

fs.rmSync(outRoot, { recursive: true, force: true });
const cssParts = [];
for (const family of FAMILIES) {
    const response = await fetch(
        `https://fonts.googleapis.com/css2?family=${family.query}&display=swap`,
        { headers: { 'User-Agent': USER_AGENT } },
    );
    if (!response.ok) {
        throw new Error(`${family.family} 样式表请求失败：${response.status}`);
    }
    const faces = parseFaces(await response.text()).filter((face) => KEEP_SUBSETS.has(face.subset));
    if (faces.length === 0) {
        throw new Error(`${family.family} 没有可用的 latin/latin-ext 字体`);
    }

    const dir = path.join(outRoot, family.slug);
    fs.mkdirSync(dir, { recursive: true });
    for (const [index, face] of faces.entries()) {
        const fileName = `${face.subset}-${String(index).padStart(2, '0')}.woff2`;
        await download(face.url, path.join(dir, fileName));
        cssParts.push(
            `/* ${family.family} · ${face.subset} */\n` +
            `@font-face {\n` +
            `  font-family: '${family.family}';\n` +
            `  font-style: normal;\n` +
            `  font-weight: ${face.weight};\n` +
            `  font-display: swap;\n` +
            `  src: url('./fonts/${family.slug}/${fileName}') format('woff2');\n` +
            (face.range ? `  unicode-range: ${face.range};\n` : '') +
            `}`,
        );
    }

    const license = await downloadLicense(family.slug.replace(/-/g, ''), dir);
    console.log(`${family.family}: ${faces.length} 个字体面，授权 ${license ?? '未找到'}`);
}

fs.writeFileSync(
    cssFile,
    `/* 由 scripts/download-fonts.mjs 生成，请勿手改。 */\n\n${cssParts.join('\n\n')}\n`,
);
console.log(`已生成 ${path.relative(projectRoot, cssFile)}，共 ${cssParts.length} 个 @font-face。`);
