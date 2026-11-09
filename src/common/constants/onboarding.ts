/**
 * 引导流程的版本号。
 *
 * 为什么单独放这里：产品侧（OnboardingView）与 QA 的 fixture 都要用它——
 * 产品用它判断「引导是否已完成」，QA 用它预写「已完成」标记以跳过引导。
 * 两边各写一份字面量时，一旦版本号 bump 而 QA 忘了跟，所有用例都会卡在
 * 「等设置中心出现」上，报错完全指不到根因。
 *
 * 放在 src/common 而不是 fronted 下，是因为 qa/** 只允许依赖 common 层
 * （见 eslint.config.mjs 的 qa 区域约束），放在 fronted 里 QA 就 import 不到。
 */
export const CURRENT_ONBOARDING_VERSION = '1';
