import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import type { ServiceCredentialSettingFormValues } from '@/common/types/vo/service-credentials-setting-vo';
import { CLOUD_AI_PROVIDER_PRESETS } from '@/common/constants/cloud-ai-provider-presets';
import { OpenAiCredentialCard } from '../components/OpenAiCredentialCard';

const translationDict: Record<string, string> = {
    'serviceCredentials.openai.usePreset': '使用预设',
    'serviceCredentials.openai.presetDialogTitle': '选择厂商预设',
    'serviceCredentials.openai.useThisPreset': '使用',
    'serviceCredentials.openai.apiFormatLabel': 'API 类型',
    'serviceCredentials.openai.apiFormatOpenai': 'OpenAI Chat Completions',
    'serviceCredentials.openai.apiFormatOpenaiResponses': 'OpenAI Responses',
    'serviceCredentials.openai.apiFormatAnthropic': 'Anthropic',
    'serviceCredentials.openai.apiFormatGemini': 'Gemini',
    'serviceCredentials.openai.urlLabel': 'API URL',
    'serviceCredentials.openai.endpointPlaceholder': 'https://api.deepseek.com/v1',
    'serviceCredentials.openai.customEndpointPlaceholder': 'http://127.0.0.1:8080/v1',
    'serviceCredentials.openai.modelsLabel': '可用模型列表',
    'serviceCredentials.openai.addPlaceholder': '输入模型标识，如 deepseek-flash',
    'serviceCredentials.openai.tableTest': '测试',
    'serviceCredentials.openai.modelEnableLabel': '启用模型 {{model}}',
    'serviceCredentials.openai.modelDisabled': '已关闭',
    'serviceCredentials.openai.saveKey': '保存',
    'serviceCredentials.openai.cancelKeyEdit': '取消',
    'serviceCredentials.openai.clearKey': '清除',
    'serviceCredentials.openai.keySaved': 'API Key 已保存',
    'serviceCredentials.openai.keyCleared': 'API Key 已清除',
    'serviceCredentials.openai.providersLabel': '服务商配置',
    'serviceCredentials.openai.addProvider': '添加配置',
    'serviceCredentials.openai.customProvider': '自定义 / 本地 AI',
    'serviceCredentials.openai.customProviderDescription': '自由填写名称、协议类型与接口地址，适用于本地部署或第三方接口',
    'serviceCredentials.openai.addCustomProvider': '新建',
    'serviceCredentials.openai.addProviderDialogTitle': '添加服务商配置',
    'serviceCredentials.openai.addProviderDialogDescription': '可新建自定义 / 本地 AI 配置，或从下方模板快速创建。',
    'serviceCredentials.openai.deleteProvider': '移除此配置',
    'serviceCredentials.openai.noProvidersHint': '暂未配置服务商',
    'serviceCredentials.openai.providerNameLabel': '配置名称',
    'serviceCredentials.openai.providerNamePlaceholder': '如 DeepSeek、本地 AI',
    'serviceCredentials.openai.copyLink': '复制链接',
    'serviceCredentials.openai.openInBrowser': '在浏览器中打开',
    'common.delete': '删除',
    'common.cancel': '取消',
};

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) => {
            if (key === 'serviceCredentials.openai.modelEnableLabel') {
                return `启用模型 ${String(params?.model ?? '')}`;
            }
            if (key === 'serviceCredentials.openai.deleteModelConfirm') {
                return `确定删除模型「${String(params?.model ?? '')}」？`;
            }
            return translationDict[key] ?? key;
        },
    }),
}));

const buildDefaultValues = (
    openai?: Partial<ServiceCredentialSettingFormValues['openai']>,
): ServiceCredentialSettingFormValues => ({
    openai: {
        hasKey: false,
        keyHint: '',
        key: '',
        clearKey: false,
        endpoint: '',
        apiFormat: 'openai',
        models: [],
        disabledModels: [],
        ...openai,
    },
    tencent: {
        hasCredentials: false,
        secretIdHint: '',
        secretId: '',
        secretKey: '',
        clearTencent: false,
    },
});

const renderCard = (defaultValues: ServiceCredentialSettingFormValues) => {
    const Wrapper: React.FC = () => {
        const form = useForm<ServiceCredentialSettingFormValues>({ defaultValues });
        return (
            <OpenAiCredentialCard
                form={form}
                testingModel={null}
                testResults={{}}
                onTestModel={() => undefined}
                onModelRemoved={() => undefined}
                onCopy={() => undefined}
                onOpenUrl={() => undefined}
            />
        );
    };
    return render(<Wrapper />);
};

describe('OpenAiCredentialCard', () => {
    it('点击「使用预设」打开弹窗并列出全部厂商预设', async () => {
        const user = userEvent.setup();
        renderCard(buildDefaultValues());

        await user.click(screen.getByRole('button', { name: '使用预设' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('选择厂商预设')).toBeInTheDocument();
        for (const preset of CLOUD_AI_PROVIDER_PRESETS) {
            const card = within(dialog).getByTestId(`provider-preset-${preset.id}`);
            expect(within(card).getAllByText(preset.name).length).toBeGreaterThanOrEqual(1);
            expect(within(card).getByText(preset.endpoint)).toBeInTheDocument();
            expect(within(card).getByText(preset.docsUrl)).toBeInTheDocument();
        }
    });

    it('选择 DeepSeek 预设后回填完整接口地址，且不覆盖已有模型列表', async () => {
        const user = userEvent.setup();
        renderCard(buildDefaultValues({
            models: ['existing-model'],
        }));

        await user.click(screen.getByRole('button', { name: '使用预设' }));
        const dialog = await screen.findByRole('dialog');
        const useButtons = within(dialog).getAllByRole('button', { name: '使用' });
        const deepSeekIndex = CLOUD_AI_PROVIDER_PRESETS.findIndex((preset) => preset.id === 'deepseek');
        await user.click(useButtons[deepSeekIndex]);

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByDisplayValue('https://api.deepseek.com/v1')).toBeInTheDocument();
        expect(screen.getByText('existing-model')).toBeInTheDocument();
    });

    it('选择 Anthropic 预设后 API 类型切换为 Anthropic', async () => {
        const user = userEvent.setup();
        renderCard(buildDefaultValues());

        await user.click(screen.getByRole('button', { name: '使用预设' }));
        const dialog = await screen.findByRole('dialog');
        const useButtons = within(dialog).getAllByRole('button', { name: '使用' });
        const anthropicIndex = CLOUD_AI_PROVIDER_PRESETS.findIndex((preset) => preset.id === 'anthropic');
        await user.click(useButtons[anthropicIndex]);

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByRole('combobox')).toHaveTextContent('Anthropic');
        expect(screen.getByDisplayValue('https://api.anthropic.com/v1')).toBeInTheDocument();
    });

    it('支持切换模型启用/关闭状态以及自由删除模型', async () => {
        const user = userEvent.setup();
        renderCard(buildDefaultValues({
            models: ['deepseek-flash'],
            disabledModels: [],
        }));

        const row = screen.getByTestId('model-row-deepseek-flash');
        const toggle = within(row).getByRole('switch', { name: '启用模型 deepseek-flash' });
        await user.click(toggle);
        expect(within(row).getByText('已关闭')).toBeInTheDocument();

        await user.click(within(row).getByRole('button', { name: '删除' }));
        const confirmDialog = await screen.findByRole('alertdialog');
        await user.click(within(confirmDialog).getByRole('button', { name: '删除' }));
        await waitFor(() => expect(screen.queryByTestId('model-row-deepseek-flash')).not.toBeInTheDocument());
    });

    it('API Key 输入后需点击保存才生效，支持取消与清除防误触', async () => {
        const user = userEvent.setup();
        renderCard(buildDefaultValues());

        const keyInput = screen.getByPlaceholderText('sk-...');
        await user.type(keyInput, 'sk-accidental');
        await user.click(screen.getByRole('button', { name: '取消' }));
        expect(keyInput).toHaveValue('');

        await user.type(keyInput, 'sk-real-key-1234');
        await user.click(screen.getByRole('button', { name: '保存' }));
        expect(keyInput).toHaveValue('');
        expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument();
    });

    it('支持添加多个服务商并在不同服务商之间独立切换', async () => {
        const user = userEvent.setup();
        renderCard(buildDefaultValues({
            activeProviderId: 'deepseek',
            providers: [
                {
                    id: 'deepseek',
                    name: 'DeepSeek',
                    apiFormat: 'openai',
                    endpoint: 'https://api.deepseek.com/v1',
                    hasKey: false,
                    keyHint: '',
                    key: '',
                    clearKey: false,
                    models: ['deepseek-flash'],
                    disabledModels: [],
                },
            ],
        }));

        await user.click(screen.getByRole('button', { name: '添加配置' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByTestId('provider-preset-custom')).toBeInTheDocument();
        const useButtons = within(dialog).getAllByRole('button', { name: '使用' });
        const openaiIndex = CLOUD_AI_PROVIDER_PRESETS.findIndex((preset) => preset.id === 'openai');
        await user.click(useButtons[openaiIndex]);

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toHaveTextContent('OpenAI Responses');
        expect(screen.queryByTestId('model-row-deepseek-flash')).not.toBeInTheDocument();

        // 切回 DeepSeek，原有模型列表独立保留
        await user.click(screen.getByTestId('provider-tab-deepseek'));
        expect(screen.getByDisplayValue('https://api.deepseek.com/v1')).toBeInTheDocument();
        expect(screen.getByTestId('model-row-deepseek-flash')).toBeInTheDocument();

        // 可删到最后一个服务商并展示空状态提示
        await user.click(screen.getByRole('button', { name: '移除此配置' }));
        await user.click(screen.getByRole('button', { name: '移除此配置' }));
        expect(screen.getByText('暂未配置服务商')).toBeInTheDocument();
    });
});
