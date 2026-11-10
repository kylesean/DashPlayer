import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import React, { useMemo } from 'react';
import {
    Boxes,
    Command,
    Globe,
    HardDrive,
    Info,
    Palette,
    Settings,
    Smartphone,
    SquarePlay,
} from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import {
    Layout,
    LayoutContent,
    LayoutPanel,
} from '@astryxdesign/core/Layout';
import { SideNav, SideNavHeading, SideNavItem } from '@astryxdesign/core/SideNav';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/VStack';
import { SETTINGS_NAV_TESTIDS, SETTINGS_SIDEBAR_TESTID } from '@/common/constants/qa-testids';

/** 设置页面各分区键名联合类型。 */
export type SettingType =
    | 'resources'
    | 'shortcut'
    | 'storage'
    | 'appearance'
    | 'proxy'
    | 'mobile'
    | 'import'
    | 'about';

/** 侧边栏导航条目定义。 */
interface SettingNavDef {
    key: SettingType;
    icon: React.ElementType;
    labelKey: string;
}

/** 设置菜单导航项列表。 */
const SETTING_ITEMS: SettingNavDef[] = [
    { key: 'shortcut', icon: Command, labelKey: 'sections.shortcut' },
    { key: 'appearance', icon: Palette, labelKey: 'sections.appearance' },
    { key: 'resources', icon: Boxes, labelKey: 'sections.resources' },
    { key: 'storage', icon: HardDrive, labelKey: 'sections.storage' },
    { key: 'proxy', icon: Globe, labelKey: 'sections.proxy' },
    { key: 'mobile', icon: Smartphone, labelKey: 'sections.mobile' },
    { key: 'import', icon: SquarePlay, labelKey: 'sections.import' },
    { key: 'about', icon: Info, labelKey: 'sections.about' },
];

/**
 * 设置中心主从布局：左侧分区导航，右侧内容。
 *
 * 按 Astryx `settings`（Settings - Form）模板组织：页面壳由外层 AppShell 提供，
 * 这里只用 Layout 的 start/content 两槽位。分区位置由左侧常驻 SideNav 的选中态
 * 与各页自己的 h2 标题表达，因此不再放面包屑——Breadcrumbs 规范要求「不要用在
 * 无父级的顶层页、只是补充主导航」，在这里既冗余又多出一条横线。
 * AppShell 已经渲染唯一的 <main>，这里不再重复声明 main landmark。
 *
 * @returns 设置中心布局 JSX 元素。
 */
const SettingLayout: React.FC = () => {
    const { t } = useI18nTranslation('settings');
    const location = useLocation();
    const navigate = useNavigate();

    const currentKey = useMemo<SettingType>(() => {
        const segments = location.pathname.split('/');
        const matched = SETTING_ITEMS.find((item) => segments.includes(item.key));
        return matched ? matched.key : 'shortcut';
    }, [location.pathname]);

    return (
        <Layout
            height="fill"
            start={
                <LayoutPanel width={240} isScrollable={false} hasDivider padding={2}>
                    <aside data-testid={SETTINGS_SIDEBAR_TESTID} className="h-full flex flex-col w-full">
                        {/* SideNav 默认固定 260px，而面板内容区只有 224px，
                            不拉满会撑出横向滚动条 */}
                        <div className="w-full [&_.astryx-side-nav]:!w-full">
                            <SideNav
                                header={
                                    <SideNavHeading
                                        heading={t('layoutTitle')}
                                        icon={<Icon icon={Settings as unknown as IconType} size="sm" />}
                                    />
                                }
                            >
                                {SETTING_ITEMS.map((item) => (
                                    <SideNavItem
                                        key={item.key}
                                        data-testid={SETTINGS_NAV_TESTIDS[item.key]}
                                        label={t(item.labelKey)}
                                        icon={
                                            <Icon
                                                icon={item.icon as unknown as IconType}
                                                size="sm"
                                                color={currentKey === item.key ? 'primary' : 'secondary'}
                                            />
                                        }
                                        isSelected={currentKey === item.key}
                                        href={`/settings/${item.key}`}
                                        onClick={() => navigate(`/settings/${item.key}`)}
                                    />
                                ))}
                            </SideNav>
                        </div>
                    </aside>
                </LayoutPanel>
            }
            content={
                <LayoutContent padding={6} isScrollable>
                    <VStack width="100%" maxWidth={960} gap={6} paddingBlockEnd={8} className="mx-auto">
                        <Outlet />
                    </VStack>
                </LayoutContent>
            }
        />
    );
};

export default SettingLayout;
