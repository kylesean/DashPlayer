import { SWR_KEY, swrApiMutate, swrMutate } from '@/frontend/lib/swr-util';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { Button } from '@astryxdesign/core/Button';
import { emptyFunc } from '@/common/utils/Util';
import { getRendererLogger } from '@/frontend/log/simple-logger';
import { fileBrowserApi } from '@/frontend/features/file-browser/fileBrowserApi';
import { useTranslation } from 'react-i18next';
import { Folder } from 'lucide-react';

const logger = getRendererLogger('FolderSelector');

export interface FolderSelectorProps {
    onSelected?: (fp: string) => void;
    className?: string;
}

export class FolderSelectAction {
    public static defaultAction(onSelected?: (vid: string) => void) {
        return async (fp: string) => {
            const [id] = await fileBrowserApi.createWatchHistory([fp]);
            onSelected?.(id);
            await swrMutate(SWR_KEY.PLAYER_P);
            await swrApiMutate('watch-history/list');
            await swrMutate(SWR_KEY.WATCH_PROJECT_DETAIL);
        };
    }

    public static defaultAction2(onSelected: (vid: string, fp: string) => void) {
        return async (fp: string) => {
            const [id] = await fileBrowserApi.createWatchHistory([fp]);
            logger.debug('Created watch history', { id });
            onSelected(id, fp);
            await swrMutate(SWR_KEY.PLAYER_P);
            await swrApiMutate('watch-history/list');
            await swrMutate(SWR_KEY.WATCH_PROJECT_DETAIL);
        };
    }
}

const FolderSelector = ({ onSelected, className }: FolderSelectorProps) => {
    const { t } = useTranslation('common');
    const handleClick = async () => {
        const ps = await fileBrowserApi.selectFolder({});
        logger.debug('Selected folder projects', { projectCount: ps.length, firstProject: ps[0] });
        if (ps.length > 0) {
            onSelected?.(ps[0]);
        }
    };

    return (
        <Tooltip content={t('folderPairingHint')} placement="below">
            <Button
                variant="secondary"
                label={t('openFolder')}
                icon={<Folder className="h-4 w-4" />}
                onClick={() => void handleClick()}
                width="100%"
                className={className}
            />
        </Tooltip>
    );
};

FolderSelector.defaultProps = {
    onSelected: emptyFunc,
    className: ''
};

export default FolderSelector;
