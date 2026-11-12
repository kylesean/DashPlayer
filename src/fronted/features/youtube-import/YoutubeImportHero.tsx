import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Clapperboard, Download, PlayCircle } from 'lucide-react';
import useSWR from 'swr';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Center } from '@astryxdesign/core/Center';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import FolderSelector, { FolderSelectAction } from '@/fronted/features/file-browser/components/FolderSelector';
import FileSelector, { FileAction } from '@/fronted/features/file-browser/components/FileSelector';
import useLayout from '@/fronted/app/stores/layoutStore';
import { parseYoutubeVideoId } from '@/common/utils/youtubeUrl';
import { youtubeImportApi } from './youtubeImportApi';
import useYoutubeImportUi from './youtubeImportUiStore';
import YoutubeImportTaskRow from './YoutubeImportTaskRow';

/**
 * 无播放历史时的主视觉：YouTube 链接导入是一等入口，粘贴即下载导入、
 * 完成后在任务行「去播放」；本地文件选择降级为次要路径。
 * 功能开关关闭时回退为旧版本地文件空状态。
 */
const YoutubeImportHero = () => {
    const { t } = useTranslation('youtubeImport');
    const { t: tc } = useTranslation('common');
    const navigate = useNavigate();
    const changeSideBar = useLayout((s) => s.changeSideBar);
    const { data: setting } = useSWR('youtube-import/setting-detail', () => youtubeImportApi.getSettingDetail(), {
        // 读取失败必须显式暴露：静默回退会让入口消失、退回旧空态，用户不知道功能其实已开启
        onError: () => toast.error(t('settings.loadFailed'), { id: 'youtube-import-setting' }),
    });
    const ytEnabled = setting?.enabled ?? false;
    const url = useYoutubeImportUi((s) => s.url);
    const setUrl = useYoutubeImportUi((s) => s.setUrl);
    const submitting = useYoutubeImportUi((s) => s.submitting);
    const tasks = useYoutubeImportUi((s) => s.tasks);
    const startImport = useYoutubeImportUi((s) => s.startImport);

    const videoId = parseYoutubeVideoId(url);
    const isInvalid = url.trim().length > 0 && !videoId;
    const canSubmit = Boolean(videoId) && !submitting;

    const localSelectors = (
        <HStack vAlign="center" hAlign="center" gap={3} width="100%">
            <FileSelector
                onSelected={FileAction.playerAction2(navigate)}
                withMkv
            />
            <FolderSelector
                onSelected={FolderSelectAction.defaultAction2(async (vid) => {
                    await fileBrowserApi.changeWindowSize('player');
                    changeSideBar(false);
                    navigate(`/player/${vid}`);
                })}
            />
        </HStack>
    );

    if (!ytEnabled) {
        // 功能关闭时的旧版空状态：仅保留本地文件入口。
        return (
            <VStack hAlign="center" gap={3} maxWidth={440} width="100%">
                <Center
                    width={64}
                    height={64}
                    className="rounded-3xl bg-accent-muted text-accent shadow-xs mb-2"
                >
                    <PlayCircle style={{ width: 32, height: 32 }} strokeWidth={1.75} />
                </Center>
                <Heading level={2} justify="center">
                    {tc('emptyWatchTitle')}
                </Heading>
                <Text type="supporting" color="secondary" justify="center" className="mb-3">
                    {tc('emptyWatchDesc')}
                </Text>
                {localSelectors}
            </VStack>
        );
    }

    return (
        <VStack hAlign="center" gap={3} maxWidth={560} width="100%">
            <Center
                width={64}
                height={64}
                className="rounded-3xl bg-accent-muted text-accent shadow-xs mb-2"
            >
                <Clapperboard style={{ width: 32, height: 32 }} strokeWidth={1.75} />
            </Center>
            <Heading level={2} justify="center">
                {t('hero.title')}
            </Heading>
            <Text type="supporting" color="secondary" justify="center" className="mb-2">
                {t('hero.description')}
            </Text>

            <VStack gap={2} width="100%">
                <TextInput
                    label={t('dialog.urlLabel')}
                    description={t('dialog.urlHelp')}
                    value={url}
                    onChange={(val) => setUrl(val)}
                    placeholder={t('dialog.placeholder')}
                    onEnter={() => {
                        if (canSubmit) void startImport();
                    }}
                    type="url"
                    width="100%"
                    size="lg"
                    hasClear
                    hasAutoFocus
                    status={isInvalid
                        ? { type: 'error', message: t('dialog.invalidUrl') }
                        : undefined}
                />
                <HStack hAlign="end">
                    <Button
                        label={t('hero.start')}
                        variant="primary"
                        size="lg"
                        icon={<Icon icon={Download as unknown as IconType} size="sm" />}
                        isLoading={submitting}
                        isDisabled={!canSubmit}
                        onClick={() => void startImport()}
                    />
                </HStack>
            </VStack>

            {tasks.length > 0 && (
                <VStack gap={2} width="100%" isScrollable className="max-h-72 mt-2">
                    {tasks.map((entry) => (
                        <YoutubeImportTaskRow key={entry.taskId} entry={entry} />
                    ))}
                </VStack>
            )}

            <VStack gap={3} width="100%" paddingBlock={2}>
                <Divider
                    label={
                        <Text type="supporting" color="secondary">
                            {t('hero.orLocal')}
                        </Text>
                    }
                />
            </VStack>
            {localSelectors}
        </VStack>
    );
};

export default YoutubeImportHero;
