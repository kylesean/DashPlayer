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
import { StackItem } from '@astryxdesign/core/Stack';
import { Divider } from '@astryxdesign/core/Divider';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import FolderSelector, { FolderSelectAction } from '@/fronted/features/file-browser/components/FolderSelector';
import FileSelector, { FileAction } from '@/fronted/features/file-browser/components/FileSelector';
import useLayout from '@/fronted/app/stores/layoutStore';
import { youtubeImportApi } from './youtubeImportApi';
import useYoutubeImportTasks from './useYoutubeImportTasks';
import YoutubeImportTaskRow from './YoutubeImportTaskRow';

/**
 * 无播放历史时的主视觉：YouTube 链接导入是一等入口，粘贴即导入、完成自动跳转播放；
 * 本地文件选择降级为次要路径。功能开关关闭时回退为旧版本地文件空状态。
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
    const { url, setUrl, submitting, taskIds, startImport, playVideo } = useYoutubeImportTasks();

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
                    <PlayCircle className="h-8 w-8 stroke-[1.75]" />
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
                <Clapperboard className="h-8 w-8 stroke-[1.75]" />
            </Center>
            <Heading level={2} justify="center">
                {t('hero.title')}
            </Heading>
            <Text type="supporting" color="secondary" justify="center" className="mb-2">
                {t('hero.description')}
            </Text>

            <HStack vAlign="center" gap={2} width="100%">
                <StackItem size="fill">
                    <TextInput
                        label={t('dialog.placeholder')}
                        isLabelHidden
                        value={url}
                        onChange={(val) => setUrl(val)}
                        placeholder={t('dialog.placeholder')}
                        onEnter={() => void startImport()}
                        type="url"
                        width="100%"
                        size="lg"
                    />
                </StackItem>
                <Button
                    label={t('hero.start')}
                    variant="primary"
                    size="lg"
                    icon={<Download className="h-4 w-4" />}
                    isLoading={submitting}
                    isDisabled={!url.trim()}
                    onClick={() => void startImport()}
                />
            </HStack>

            {taskIds.length > 0 && (
                <VStack gap={2} width="100%" isScrollable className="max-h-72 mt-2">
                    {taskIds.map((taskId) => (
                        <YoutubeImportTaskRow
                            key={taskId}
                            taskId={taskId}
                            onPlay={(result) => void playVideo(result)}
                        />
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
