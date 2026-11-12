import { expect, type Locator, type Page } from '@playwright/test';
import { isSecretPersisted, launchAppSession, readConfigValue, test } from '../../support/fixtures';
import { openSettingsSection, reloadSettingsPage, switchSettingsSection, chooseInRow, selectInRow } from '../../support/settings-page';
import { SettingKeyObj } from '../../../src/common/types/store_schema';

/** 进入服务与资源设置页。 */
async function openResourcesSetting(page: Page): Promise<void> {
    await openSettingsSection(page, 'resources', page.getByRole('heading', { name: '服务与资源' }));
}

/** 切到服务与资源页的页内分区。 */
async function openResourcesTab(page: Page, tab: '本地资源' | '云端服务' | '翻译与查词'): Promise<void> {
    await page.getByRole('tab', { name: tab, exact: true }).click();
}

/** 「API 类型」下拉的显示文案到存储枚举值的对应表。 */
const API_FORMAT_BY_LABEL: Record<string, string> = {
    'OpenAI 兼容': 'openai',
    'Anthropic 兼容': 'anthropic',
    'Gemini': 'gemini',
};

/** 云端服务里填写的 API Key，仅用于验证落盘，不是真实密钥。 */
const API_KEY = 'sk-e2e-not-a-real-key';
/** 云端服务里填写的接口地址。 */
const ENDPOINT = 'https://api.e2e.test/v1';
/** 新增的模型标识。 */
const NEW_MODEL = 'e2e-model-alpha';
/** 自定义翻译风格提示词。 */
const CUSTOM_STYLE = 'E2E 自定义翻译风格：保持原句语序';
/** 内置默认模型：从产品 schema 取，避免升级模型后用例硬编码过期。 */
const DEFAULT_MODEL = SettingKeyObj['models.openai.available'];
/**
 * 已保存密钥后 API Key 输入框的占位提示。
 *
 * 详情接口不下发明文，只给「•••• + 末四位」的脱敏提示；输入框留空表示沿用已保存的值。
 * 按末四位拼出完整文案，既能抓住「明文回显」回归，也能抓住「脱敏格式退化」。
 */
const SAVED_KEY_PLACEHOLDER = `已保存 ••••${API_KEY.slice(-4)}，留空即沿用`;

/**
 * 删除模型行：先点行内删除，再在统一确认弹窗里确认。
 *
 * 删除模型不可撤销，产品是两步交互——只点行内按钮不会落盘，也不会让表格行消失。
 *
 * @param page 应用主窗口页面。
 * @param row 目标模型所在的表格行。
 */
async function deleteModelRow(page: Page, row: Locator): Promise<void> {
    await row.getByRole('button', { name: '删除' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '删除' }).click();
    await expect(dialog).toBeHidden();
}

test.describe('服务与资源设置', () => {
    test('[SET-SVC-01] 云端服务填写的密钥、接口地址与模型清单会落盘，重进页面仍回显 @smoke', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);
        await openResourcesTab(page, '云端服务');

        await page.getByPlaceholder('sk-...').fill(API_KEY);
        await page.getByPlaceholder('https://api.deepseek.com/v1').fill(ENDPOINT);

        // 模型标识靠「添加」进列表，不是直接编辑文本
        await page.getByPlaceholder('输入模型标识，如 gpt-4o-mini').fill(NEW_MODEL);
        await page.getByRole('button', { name: '添加' }).click();
        await expect(page.getByRole('cell', { name: NEW_MODEL })).toBeVisible();

        await expect.poll(() => isSecretPersisted(userDataDir, 'apiKeys.openAi.key', API_KEY)).toBe(true);
        await expect.poll(() => readConfigValue(userDataDir, 'apiKeys.openAi.endpoint')).toBe(ENDPOINT);
        // 模型清单以换行文本落盘；断言包含而不是全等，避免绑死内置默认模型
        await expect.poll(() => readConfigValue(userDataDir, 'models.openai.available')).toContain(NEW_MODEL);

        // 重进页面：密钥不再明文下发，只展示脱敏提示；地址与模型清单仍来自后端回读
        await reloadSettingsPage(page, page.getByRole('heading', { name: '服务与资源' }));
        const savedKeyInput = page.getByPlaceholder(SAVED_KEY_PLACEHOLDER);
        await expect(savedKeyInput).toHaveAttribute('placeholder', SAVED_KEY_PLACEHOLDER);
        await expect(savedKeyInput).toHaveValue('');
        await expect(savedKeyInput).not.toHaveAttribute('placeholder', new RegExp(API_KEY));
        await expect(page.getByPlaceholder('https://api.deepseek.com/v1')).toHaveValue(ENDPOINT);
        await expect(page.getByRole('cell', { name: NEW_MODEL })).toBeVisible();

        // 留空保存必须沿用旧 key：只改接口地址触发一次自动保存，密钥输入框保持为空
        const rotatedEndpoint = 'https://api.e2e.test/v2';
        await page.getByPlaceholder('https://api.deepseek.com/v1').fill(rotatedEndpoint);
        await expect.poll(() => readConfigValue(userDataDir, 'apiKeys.openAi.endpoint')).toBe(rotatedEndpoint);
        await expect.poll(() => isSecretPersisted(userDataDir, 'apiKeys.openAi.key', API_KEY)).toBe(true);

        // 再重进一次：密钥仍是「已保存」的脱敏态，说明留空保存没有把旧 key 当成清空
        await reloadSettingsPage(page, page.getByRole('heading', { name: '服务与资源' }));
        await expect(page.getByPlaceholder(SAVED_KEY_PLACEHOLDER)).toHaveValue('');
        await expect(page.getByPlaceholder('https://api.deepseek.com/v1')).toHaveValue(rotatedEndpoint);
        await expect(page.getByRole('cell', { name: NEW_MODEL })).toBeVisible();
    });

    test('[SET-SVC-02] 识别方式、翻译风格与词典补充方式改动会落盘，重进页面仍回显', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);

        // 识别方式现在固定展示在「本地资源」里，不再藏在详情后面
        await chooseInRow(page, 'transcription', '兼容模式');
        await expect.poll(() => readConfigValue(userDataDir, 'transcription.engine')).toBe('sherpa-onnx');

        // 翻译风格切到自定义后，提示词输入框才出现并可编辑
        await openResourcesTab(page, '翻译与查词');
        await chooseInRow(page, 'subtitleStyle', '自定义');
        const customStyleInput = page.getByTestId('custom-subtitle-style');
        await customStyleInput.fill(CUSTOM_STYLE);

        await chooseInRow(page, 'dictionary', '不补充');

        await expect.poll(() => readConfigValue(userDataDir, 'features.openai.subtitleTranslationMode')).toBe('custom');
        await expect.poll(() => readConfigValue(userDataDir, 'features.openai.subtitleCustomStyle')).toBe(CUSTOM_STYLE);
        await expect.poll(() => readConfigValue(userDataDir, 'providers.dictionary')).toBe('none');

        // 重进页面：三项选择与自定义提示词都来自后端回读（分区由 ?tab= 保留）
        await reloadSettingsPage(page, page.getByRole('heading', { name: '服务与资源' }));
        await expect(selectInRow(page, 'subtitleStyle')).toHaveText('自定义');
        await expect(page.getByTestId('custom-subtitle-style')).toHaveValue(CUSTOM_STYLE);
        await expect(selectInRow(page, 'dictionary')).toHaveText('不补充');

        await openResourcesTab(page, '本地资源');
        await expect(selectInRow(page, 'transcription')).toHaveText('兼容模式');
    });

    test('[SET-SVC-03] 识别方式在兼容模式与硬件加速之间往返切换都落盘，重进页面回显最后一次选择', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);

        // 默认是硬件加速，先切到兼容模式，确认同一个下拉换回来也能写回配置
        await expect(selectInRow(page, 'transcription')).toHaveText('硬件加速（推荐）');
        await chooseInRow(page, 'transcription', '兼容模式');
        await expect.poll(() => readConfigValue(userDataDir, 'transcription.engine')).toBe('sherpa-onnx');

        await chooseInRow(page, 'transcription', '硬件加速（推荐）');
        await expect.poll(() => readConfigValue(userDataDir, 'transcription.engine')).toBe('whisper-cpp');

        await reloadSettingsPage(page, page.getByRole('heading', { name: '服务与资源' }));
        await expect(selectInRow(page, 'transcription')).toHaveText('硬件加速（推荐）');
    });

    test('[SET-SVC-04] 使用厂商预设会回填接口地址与 API 类型并落盘，重进页面仍回显', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);
        await openResourcesTab(page, '云端服务');

        await page.getByRole('button', { name: '使用预设' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('选择厂商预设')).toBeVisible();

        // 预设的地址与类型从弹窗里现读，断言不写死具体厂商参数
        const presetCard = dialog.getByTestId('provider-preset-anthropic');
        const presetEndpoint = (await presetCard.getByTestId('provider-preset-endpoint').innerText()).trim();
        const presetFormatLabel = (await presetCard.getByTestId('provider-preset-format').innerText()).trim();
        await presetCard.getByRole('button', { name: '使用', exact: true }).click();
        await expect(dialog).toBeHidden();

        const presetApiFormat = API_FORMAT_BY_LABEL[presetFormatLabel];
        await expect.poll(() => readConfigValue(userDataDir, 'apiKeys.openAi.endpoint')).toBe(presetEndpoint);
        await expect.poll(() => readConfigValue(userDataDir, 'apiKeys.openAi.apiFormat')).toBe(presetApiFormat);

        // 当前页面即时回显
        await expect(page.getByPlaceholder('https://api.deepseek.com/v1')).toHaveValue(presetEndpoint);
        await expect(selectInRow(page, 'apiFormat')).toHaveText(presetFormatLabel);

        // 重进页面：地址与类型来自后端回读
        await reloadSettingsPage(page, page.getByRole('heading', { name: '服务与资源' }));
        await expect(page.getByPlaceholder('https://api.deepseek.com/v1')).toHaveValue(presetEndpoint);
        await expect(selectInRow(page, 'apiFormat')).toHaveText(presetFormatLabel);
    });

    test('[SET-SVC-05] 新增的模型可以删除，被功能占用的模型不能删除', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);
        await openResourcesTab(page, '云端服务');

        // 内置默认模型被整句讲解等功能占用，删除按钮应当禁用
        const inUseRow = page.getByTestId(`model-row-${DEFAULT_MODEL}`);
        await expect(inUseRow).toBeVisible();
        await expect(inUseRow.getByRole('button', { name: '删除' })).toBeDisabled();

        // 新加的模型没被任何功能占用，可以删掉
        const temporaryModel = 'e2e-model-temp';
        await page.getByPlaceholder('输入模型标识，如 gpt-4o-mini').fill(temporaryModel);
        await page.getByRole('button', { name: '添加' }).click();
        await expect.poll(() => readConfigValue(userDataDir, 'models.openai.available')).toContain(temporaryModel);

        const temporaryRow = page.getByTestId(`model-row-${temporaryModel}`);
        await expect(temporaryRow.getByRole('button', { name: '删除' })).toBeEnabled();
        await deleteModelRow(page, temporaryRow);

        // 删除同样要写回配置，而不是只从界面表格里消失
        await expect.poll(() => readConfigValue(userDataDir, 'models.openai.available')).not.toContain(temporaryModel);
        await expect(page.getByTestId(`model-row-${temporaryModel}`)).toHaveCount(0);
    });

    test('[SET-SVC-06] 把字幕翻译指到新增的云端模型后，模型槽位落盘并回显', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);
        await openResourcesTab(page, '云端服务');

        await page.getByPlaceholder('输入模型标识，如 gpt-4o-mini').fill(NEW_MODEL);
        await page.getByRole('button', { name: '添加' }).click();
        await expect.poll(() => readConfigValue(userDataDir, 'models.openai.available')).toContain(NEW_MODEL);

        // 功能下拉里的模型清单来自详情缓存，保存成功后缓存会立刻刷新，新模型无需重进页面即可选中
        await openResourcesTab(page, '翻译与查词');
        await chooseInRow(page, 'subtitleTranslation', NEW_MODEL);

        // 引擎原本就是云端，写盘上唯一的变化是「上次选的模型」这个槽位
        await expect.poll(() => readConfigValue(userDataDir, 'models.openai.subtitleTranslation')).toBe(NEW_MODEL);

        await reloadSettingsPage(page, page.getByRole('heading', { name: '服务与资源' }));
        await expect(selectInRow(page, 'subtitleTranslation')).toHaveText(NEW_MODEL);
    });

    test('[SET-SVC-07] 字幕翻译下拉不再提供已下线的本地轻量引擎，切到关闭后引擎落盘并回显', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);
        await openResourcesTab(page, '翻译与查词');

        // OPUS-MT 轻量管线已移除：下拉里不能再出现「本地基础资源包」，
        // 否则用户选了它，实际却走别的引擎，提示与真实能力不符。
        await selectInRow(page, 'subtitleTranslation').click();
        await expect(page.getByRole('option', { name: '关闭' })).toBeVisible();
        await expect(page.getByRole('option', { name: '本地基础资源包' })).toHaveCount(0);
        await expect(page.getByText('轻量翻译只支持中文')).toHaveCount(0);
        await page.getByRole('option', { name: '关闭' }).click();

        await expect.poll(() => readConfigValue(userDataDir, 'providers.subtitleTranslation')).toBe('none');

        await reloadSettingsPage(page, page.getByRole('heading', { name: '服务与资源' }));
        await expect(selectInRow(page, 'subtitleTranslation')).toHaveText('关闭');
    });

    test('[SET-SVC-08] 词典查询切到本地增强资源包后引擎落盘，重进页面回显并提示资源未下载', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);
        await openResourcesTab(page, '翻译与查词');

        await chooseInRow(page, 'dictionary', '本地增强资源包');

        await expect.poll(() => readConfigValue(userDataDir, 'providers.dictionary')).toBe('local');
        // 本地增强模型还没下载时，页面必须说清为什么现在用不了
        await expect(page.getByText('本地增强资源包还没下载')).toBeVisible();

        await reloadSettingsPage(page, page.getByRole('heading', { name: '服务与资源' }));
        await expect(selectInRow(page, 'dictionary')).toHaveText('本地增强资源包');
    });

    test('[SET-SVC-09] 整句讲解切到禁用后开关落盘为关闭，重进页面仍回显禁用', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);
        await openResourcesTab(page, '翻译与查词');

        // 默认开启，且默认指向内置云端模型
        await expect(selectInRow(page, 'sentenceLearning')).not.toHaveText('禁用');

        await chooseInRow(page, 'sentenceLearning', '禁用');

        await expect.poll(() => readConfigValue(userDataDir, 'features.openai.enableSentenceLearning')).toBe('false');

        await reloadSettingsPage(page, page.getByRole('heading', { name: '服务与资源' }));
        await expect(selectInRow(page, 'sentenceLearning')).toHaveText('禁用');
    });

    test('[SET-SVC-10] 把功能从云端模型切走后，原模型的删除按钮恢复可用且删得掉', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);
        await openResourcesTab(page, '云端服务');

        // 新加的模型指给字幕翻译后就成了「在用」的模型，占用是现算的，删除按钮随之禁用
        await page.getByPlaceholder('输入模型标识，如 gpt-4o-mini').fill(NEW_MODEL);
        await page.getByRole('button', { name: '添加' }).click();
        await openResourcesTab(page, '翻译与查词');
        await chooseInRow(page, 'subtitleTranslation', NEW_MODEL);
        await expect.poll(() => readConfigValue(userDataDir, 'models.openai.subtitleTranslation')).toBe(NEW_MODEL);

        await openResourcesTab(page, '云端服务');
        const modelRow = page.getByTestId(`model-row-${NEW_MODEL}`);
        await expect(modelRow.getByRole('button', { name: '删除' })).toBeDisabled();

        // 把字幕翻译关掉：占用应当当场解除，不需要重进页面
        await openResourcesTab(page, '翻译与查词');
        await chooseInRow(page, 'subtitleTranslation', '关闭');
        await openResourcesTab(page, '云端服务');
        await expect(modelRow.getByRole('button', { name: '删除' })).toBeEnabled();

        await deleteModelRow(page, modelRow);
        await expect.poll(() => readConfigValue(userDataDir, 'models.openai.available')).not.toContain(NEW_MODEL);
        await expect(page.getByTestId(`model-row-${NEW_MODEL}`)).toHaveCount(0);
    });

    test('[SET-SVC-11] 关掉应用再打开，云端密钥仍原样回读', async ({ userDataDir }) => {
        const first = await launchAppSession(userDataDir);
        try {
            await openResourcesSetting(first.page);
            await openResourcesTab(first.page, '云端服务');
            await first.page.getByPlaceholder('sk-...').fill(API_KEY);
            await expect.poll(() => isSecretPersisted(userDataDir, 'apiKeys.openAi.key', API_KEY)).toBe(true);
        } finally {
            await first.close();
        }

        // 重启后不做任何操作：密钥必须来自持久化配置，且只以脱敏提示呈现、不回传明文
        const restarted = await launchAppSession(userDataDir);
        try {
            await openResourcesSetting(restarted.page);
            await openResourcesTab(restarted.page, '云端服务');
            const savedKeyInput = restarted.page.getByPlaceholder(SAVED_KEY_PLACEHOLDER);
            await expect(savedKeyInput).toHaveAttribute('placeholder', SAVED_KEY_PLACEHOLDER);
            await expect(savedKeyInput).toHaveValue('');
            await expect(savedKeyInput).not.toHaveAttribute('placeholder', new RegExp(API_KEY));
        } finally {
            await restarted.close();
        }
    });

    test('[SET-SVC-13] 把云端模型清单删空后清单保持为空，此时改动偏好仍会正常落盘', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);
        await openResourcesTab(page, '翻译与查词');

        // 默认那个模型被三处占用，先逐个解绑，删除按钮才会亮
        await chooseInRow(page, 'sentenceLearning', '禁用');
        await chooseInRow(page, 'subtitleTranslation', '关闭');
        await chooseInRow(page, 'dictionary', '不补充');
        await expect.poll(() => readConfigValue(userDataDir, 'providers.subtitleTranslation')).toBe('none');

        await openResourcesTab(page, '云端服务');
        const builtinRow = page.getByTestId(`model-row-${DEFAULT_MODEL}`);
        await expect(builtinRow.getByRole('button', { name: '删除' })).toBeEnabled();
        await deleteModelRow(page, builtinRow);

        // 清空就是清空：清单在磁盘上留空，不会又被兜底成默认模型塞回来
        await expect.poll(() => readConfigValue(userDataDir, 'models.openai.available')).toBe('');
        await expect(page.getByTestId(`model-row-${DEFAULT_MODEL}`)).toHaveCount(0);
        await reloadSettingsPage(page, page.getByRole('heading', { name: '服务与资源' }));
        await expect(page.getByTestId(`model-row-${DEFAULT_MODEL}`)).toHaveCount(0);

        // 清单为空只该拦住「要用云端」的功能，不该连带把无关偏好一起拒绝保存
        await openResourcesTab(page, '翻译与查词');
        await chooseInRow(page, 'subtitleStyle', '简化英文');
        await expect.poll(() => readConfigValue(userDataDir, 'features.openai.subtitleTranslationMode')).toBe('simple_en');
        // 值落盘之外还要确认页面没弹保存失败横幅：保存被拒时值也不会变，
        // 但「值没变」只会表现为超时，横幅才是用户看到的那句错误。放保存之后断言才抓得到。
        await expect(page.getByRole('alert')).toHaveCount(0);
    });

    test('[SET-SVC-17] 填完密钥立刻切到别的设置栏目，密钥仍会落盘并在重进后回显', async ({ session, userDataDir }) => {
        const page = session.page;
        await openResourcesSetting(page);
        await openResourcesTab(page, '云端服务');

        await page.getByPlaceholder('sk-...').fill(API_KEY);

        // 关键：填完立刻离开，不给 600ms 防抖留时间。密钥是最不能丢的值，
        // 用户填完随手切走若静默丢失，会表现为「填了密钥但还是提示未配置」。
        await switchSettingsSection(page, 'appearance', page.getByRole('radio', { name: '深色' }));

        await expect.poll(() => isSecretPersisted(userDataDir, 'apiKeys.openAi.key', API_KEY)).toBe(true);

        // 回到该页：密钥来自后端回读的脱敏提示，页面里不再残留明文输入
        await switchSettingsSection(page, 'resources', page.getByRole('heading', { name: '服务与资源' }));
        await openResourcesTab(page, '云端服务');
        const savedKeyInput = page.getByPlaceholder(SAVED_KEY_PLACEHOLDER);
        await expect(savedKeyInput).toHaveAttribute('placeholder', SAVED_KEY_PLACEHOLDER);
        await expect(savedKeyInput).toHaveValue('');
        await expect(savedKeyInput).not.toHaveAttribute('placeholder', new RegExp(API_KEY));
    });
});
