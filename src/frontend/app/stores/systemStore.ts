import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import PathUtil from '@/common/utils/PathUtil';
import { backendClient } from '@/frontend/infrastructure/electron/backendClient';

const api = backendClient;

/** 宿主操作系统运行时信息状态。 */
type State = {
    isWindows: boolean;
    isMac: boolean;
    isLinux: boolean;
    pathSeparator: string;
};

/** 系统状态更新动作。 */
type Actions = {
    /** 显式更新 Windows 平台标识。 */
    setIsWin: (isWin: boolean) => void;
};

/**
 * 管理系统平台信息，供前端按操作系统差异调整界面行为。
 */
const useSystem = create(
    subscribeWithSelector<State & Actions>((set) => ({
        isWindows: false,
        isMac: false,
        isLinux: false,
        pathSeparator: '',
        setIsWin: (isWin: boolean) => set({ isWindows: isWin }),
    })),
);

/**
 * 从主进程同步系统平台与路径分隔符信息。
 */
export const syncStatus = () => {
    api.call('system/info').then((sysInfo) => {
        useSystem.setState({
            isWindows: sysInfo.isWindows,
            isMac: sysInfo.isMac,
            isLinux: sysInfo.isLinux,
            pathSeparator: sysInfo.pathSeparator,
        });
        PathUtil.SEPARATOR = sysInfo.pathSeparator;
    });
};

export default useSystem;
