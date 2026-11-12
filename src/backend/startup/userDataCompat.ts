/**
 * 改名后保住老用户的 userData 目录。
 *
 * `package.json` 的 productName 从 DashPlayer 改成 Refrain 之后，Electron 默认的
 * userData 会从 `<appData>/DashPlayer` 变成 `<appData>/Refrain`，配置、数据库、日志、
 * 内置词典会全部"消失"。这里在任何模块读取 `app.getPath('userData')` 之前，把路径
 * 钉回旧目录。
 *
 * 必须在 `src/main.ts` 的**第一行**导入：`store.ts`、`simple-logger.ts`、`db.ts`
 * 都在模块顶层就算好了路径，晚一步就来不及。
 *
 * 只在旧目录存在、且新目录还没有数据时才回退。已经用 Refrain 目录跑过的用户不会被
 * 反向拉回旧目录。
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const LEGACY_APP_NAME = 'DashPlayer';

const legacyUserData = path.join(app.getPath('appData'), LEGACY_APP_NAME);
const currentUserData = app.getPath('userData');

const hasData = (dir: string): boolean => {
    try {
        return fs.readdirSync(dir).length > 0;
    } catch {
        return false;
    }
};

if (fs.existsSync(legacyUserData) && !hasData(currentUserData)) {
    app.setPath('userData', legacyUserData);
}
