/**
 * 系统级代理探测结果。
 */
export interface ProxySystemProxyInfo {
    /** 是否探测到系统代理（Linux 环境变量 / macOS scutil / Windows 注册表）。 */
    detected: boolean;
    /** 探测到的代理地址；未探测到为 null。 */
    url: string | null;
}

/**
 * 代理设置详情 VO。
 */
export interface ProxySettingDetailVO {
    /** 代理模式：system 跟随系统 / custom 自定义 / none 不使用。 */
    mode: 'system' | 'custom' | 'none';
    /** 自定义代理地址，仅在 custom 模式下使用。 */
    url: string;
    /** 代理绕过规则，仅在 custom 模式下使用。 */
    bypassRules: string;
    /**
     * 系统级代理探测结果。
     *
     * system 模式依赖它发现代理；探测不到时 yt-dlp 等子进程将直连目标站点。
     * 读取失败同样视为未探测到。
     */
    systemProxy: ProxySystemProxyInfo;
}

/**
 * 代理设置保存值对象。
 *
 * 当前与详情结构一致，单独导出是为了保持接口语义清晰。
 */
export interface ProxySettingSaveVO {
    /** 代理模式：system 跟随系统 / custom 自定义 / none 不使用。 */
    mode: ProxySettingDetailVO['mode'];
    /** 自定义代理地址，仅在 custom 模式下使用。 */
    url: string;
    /** 代理绕过规则，仅在 custom 模式下使用。 */
    bypassRules: string;
}
