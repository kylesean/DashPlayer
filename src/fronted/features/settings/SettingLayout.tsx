import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import React, { useMemo } from 'react';
import {
    Boxes,
    Command,
    Compass,
    Database,
    Globe,
    Link2,
    Palette,
    Smartphone,
} from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import {
    Layout,
    LayoutContent,
    LayoutPanel,
} from '@astryxdesign/core/Layout';
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';
import { Breadcrumbs, BreadcrumbItem } from '@astryxdesign/core/Breadcrumbs';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/VStack';

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
    { key: 'storage', icon: Database, labelKey: 'sections.storage' },
    { key: 'proxy', icon: Globe, labelKey: 'sections.proxy' },
    { key: 'mobile', icon: Smartphone, labelKey: 'sections.mobile' },
    { key: 'import', icon: Link2, labelKey: 'sections.import' },
    { key: 'about', icon: Compass, labelKey: 'sections.about' },
];

/**
 * 设置中心顶层母版布局组件。
 *
 * 采用 Astryx Layout 五槽位骨架（LayoutPanel + SideNav 侧边栏、LayoutHeader 面包屑导航与 LayoutContent 内容区）。
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

    const activeItem = useMemo(
        () => SETTING_ITEMS.find((item) => item.key === currentKey) || SETTING_ITEMS[0],
        [currentKey]
    );

    return (
        <Layout
            height="fill"
            start={
                <LayoutPanel width={220} isScrollable={false} hasDivider padding={2}>
                    <SideNav
                        header={
                            <HStack align="center" paddingInline={2} minHeight={36}>
                                <Heading level={3} weight="bold">
                                    {t('layoutTitle')}
                                </Heading>
                            </HStack>
                        }
                    >
                        {SETTING_ITEMS.map((item) => (
                            <SideNavItem
                                key={item.key}
                                label={t(item.labelKey)}
                                icon={
                                    <Icon
                                        icon={item.icon as unknown as IconType}
                                        size="sm"
                                        color={currentKey === item.key ? 'primary' : 'secondary'}
                                    />
                                }
                                isSelected={currentKey === item.key}
                                onClick={() => navigate(`/settings/${item.key}`)}
                            />
                        ))}
                    </SideNav>
                </LayoutPanel>
            }
            content={
                <VStack height="fill" width="100%" gap={0}>
                    <HStack minHeight={48} align="center" paddingInline={6} paddingBlock={2}>
                        <Breadcrumbs label={t('layoutTitle')} variant="supporting">
                            <BreadcrumbItem onClick={() => navigate('/settings/shortcut')}>
                                {t('layoutTitle')}
                            </BreadcrumbItem>
                            <BreadcrumbItem isCurrent>
                                {t(activeItem.labelKey)}
                            </BreadcrumbItem>
                        </Breadcrumbs>
                    </HStack>
                    <Divider variant="subtle" />
                    <LayoutContent padding={6} isScrollable>
                        <VStack maxWidth={840} width="100%" gap={6} paddingBlockEnd={8}>
                            <Outlet />
                        </VStack>
                    </LayoutContent>
                </VStack>
            }
        />
    );
};

export default SettingLayout;
