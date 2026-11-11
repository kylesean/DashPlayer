# DashPlayer AI-native 沉浸式学习重构方案

> 状态：R0–R2 已完成，R3 已落地暂停微回忆、场景化角色扮演、跟读节奏反馈、个人记忆图谱、推荐→复习联动与可选本地场景切分
> 日期：2026-11-12
> 范围：播放器、字幕、生词、句子学习、跟读/听写、AI 学习页
> 一句话：把 DashPlayer 从「视频播放器 + 学习工具」重构为「内容 × 上下文 × 学习者记忆」的沉浸式学习系统。

## 1. 判断：现在缺的不是功能，而是学习记忆

DashPlayer 已经有很好的原始能力：

- 双语字幕、逐句定位、单词弹窗、词典与发音。
- 基于本地词典和 wink NLP 的字幕分词、lemma 与生词匹配。
- 句子重点词、整句补全、AI 对话。
- 跟读、听写、词级对齐评分。
- 本地模型与云端模型的路由能力。

但这些能力目前是分散的：

- **语义缺口**：下划线同时承担「我收藏过」「默认词表」「系统觉得难」三种含义，用户无法判断它为什么出现。
- **上下文缺口**：词被保存成词条，却没有记录它在哪一句、哪个视频、什么场景、用户当时做了什么。
- **记忆缺口**：没有「已掌握 / 学习中 / 已忽略」状态，没有遗忘曲线，也没有真正的复习闭环。
- **反馈缺口**：用户只能收藏/取消收藏，不能告诉系统「我认识」「这次别提示」「我已经会了」。

一个具体证据：`resources/default-vocabulary.jsonl` 当前约 5,895 条词，应用在空数据库启动时会把它写入 `dp_words`；而现有下划线逻辑把 `dp_words` 直接当成「我的生词」。这会让新用户在没有任何个人学习意图的情况下看到大量标记。这不是算法问题，是领域模型没有区分「词典」「starter pack」和「用户状态」。

因此下一步不是再加一个 AI 功能，而是补上产品的核心底座：**学习者记忆**。

产品公式可以写成：

```text
内容（看什么）
  × 上下文（此刻这句话怎么理解）
  × 学习者记忆（你已经会什么、下一步该学什么）
  = 可持续的沉浸式学习
```

AI 的角色不是「每处都生成内容」，而是做这三者之间的**编排者**：理解当前语境、推断学习者状态、在正确的时机提供最小必要的帮助。

## 2. 北极星体验

### 2.1 一年后的理想使用场景

用户打开一部电影或一集播客：

1. 应用知道用户的英语水平和学习目标，但不要求每次先做测试。
2. 播放器默认保持安静，只在真正值得注意的地方给出极弱提示。
3. 用户点开一个词，看到的不是通用词典，而是「在这个句子里它是什么意思」「你上次在哪里见过它」「为什么系统认为它值得学」。
4. 用户说「我认识」，这个词立刻从提示层消失，并进入更长的复习间隔。
5. 在自然停顿处，应用偶尔提供 20 秒的微回忆或跟读，而不是弹出考试。
6. 视频结束，应用生成一张 90 秒的「本次学习摘要」：3 个词、1 个句子、1 个表达、1 个口语任务。
7. 第二天，应用把到期复习词和一部符合用户兴趣、难度接近 i+1 的视频放在一起。

这不是「播放器旁边多了一个 AI 聊天框」，而是**播放器本身变成了一个有记忆的沉浸式学习环境**。

### 2.2 设计原则

- **一个信号只表达一件事**：下划线只表示「这个词处于你的学习状态」，不再同时表示推荐、难度和收藏。
- **上下文优先于词典**：先解释「在这句话里是什么意思」，再给完整释义。
- **AI 安静、可解释、可关闭**：AI 不抢占播放；每次主动提示都能回答「为什么现在提示我」。
- **Grounded AI**：释义、例句、难度优先来自本地词典和当前视频上下文；模型负责解释和组织，不负责凭空发明事实。
- **Local-first**：实时标注、记忆和复习不依赖网络；云模型只做可选的深度增强。
- **衡量留存，不衡量点击**：核心指标不是「AI 被点了多少次」，而是「这个词 7 天后是否还能回忆」。
- **不打断心流**：任何练习都必须发生在自然停顿处，不能把视频变成答题关卡。
- **用户拥有自己的学习数据**：可查看、可纠正、可导出、可删除。

## 3. 目标架构：三层学习系统

```text
┌──────────────────────────────────────────────────────┐
│ 3. Calm Interaction Layer                            │
│ 字幕注释 / 文稿状态 / 词卡 / 复习坞 / 学习指南针      │
├──────────────────────────────────────────────────────┤
│ 2. Context Intelligence Layer                        │
│ 分词与 lemma / 词典特征 / 向量检索 / 候选评分         │
│ 学习时机检测 / 自适应字幕 / 语音评分 / LLM 增强       │
├──────────────────────────────────────────────────────┤
│ 1. Learner Memory Layer                              │
│ 学习者画像 / 单词状态 / 遭遇事件 / 会话 / 复习卡      │
└──────────────────────────────────────────────────────┘
```

### 3.1 Learner Memory Layer：学习者记忆层

这是整个系统的单一事实来源。所有界面都从这里读取状态，所有交互都向这里写入证据。

核心对象：

- `LearnerProfile`：英语水平、目标、兴趣、每日预算、提示强度。
- `WordState`：用户对一个 lemma 的当前状态。
- `WordEncounter`：一次真实遭遇，记录时间、视频、句子、行为和上下文。
- `LearningSession`：一次观看/练习会话及其结果。
- `ReviewCard`：FSRS 复习卡与到期时间。
- `Recommendation`：系统推荐过什么、用户接受还是忽略。

### 3.2 Context Intelligence Layer：上下文智能层

把「字幕文本」变成可解释、可评分的上下文包：

- 分词、词性、lemma、短语与搭配。
- 词典释义、音标、CEFR、词频、考试标签。
- 句子主题向量、视频主题向量、用户兴趣向量。
- 目标词候选与「为什么值得学」的理由。
- 句子理解难度、学习时机、是否需要 L1 辅助。
- 可选的 LLM 深度解释、例句、复述和角色扮演。

### 3.3 Calm Interaction Layer：安静交互层

不是把所有能力都铺在界面上，而是按注意力和时机分层：

- **播放层**：只保留最低限度提示。
- **文稿层**：提供更丰富的状态、筛选和上下文。
- **词卡层**：按需展开的解释和动作。
- **会话层**：在停顿、结束、复习时出现的微交互。
- **指南针层**：跨视频的目标、进度和下一步内容。

## 4. 学习者记忆模型

### 4.1 单词状态

建议只保留四个稳定状态：

| 状态 | 含义 | 默认视觉 |
| --- | --- | --- |
| `learning` | 用户明确要学，或系统认为正在学习 | 轻量下划线或左侧细标记 |
| `familiar` | 见过、有印象，但还不稳定 | 更弱的点状标记，可关闭 |
| `known` | 用户确认已掌握，或长期稳定回忆 | 不标记 |
| `ignored` | 当前不想看到，或与目标无关 | 不标记，且抑制推荐 |

`candidate` 不进入稳定状态，只是推荐层的临时候选。

### 4.2 来源

每个词状态必须有来源，避免再次出现「默认词表被当成个人生词」：

- `manual`：用户主动收藏。
- `imported`：用户导入的词表。
- `default`：产品内置 starter pack，可选启用，不默认进入个人生词。
- `suggested`：系统推荐后被用户接受。
- `legacy`：迁移前已有的历史数据。

### 4.3 证据事件

每次交互写入 `WordEncounter`，而不是直接修改一个孤立的 `mastery` 数字：

- `seen`：字幕中出现。
- `hover`：悬停。
- `open`：打开词卡。
- `lookup`：查词。
- `replay`：回听该句。
- `save`：加入学习。
- `known`：标记已掌握。
- `ignore`：忽略。
- `shadow`：跟读。
- `dictation`：听写。
- `review`：复习评分。

这样以后可以重新计算掌握度、推荐分数和复习计划，而不是被一次错误的状态覆盖。

### 4.4 掌握度与不确定性

不建议一开始就上深度知识追踪。先做一个透明、可解释的本地模型：

- 每个词维护一个掌握概率 `p_know` 和置信度 `confidence`。
- 查词、跟读失败、复习遗忘降低掌握概率；成功回忆、听写正确、长期未遗忘提高掌握概率。
- 用户手动「已掌握」是强证据，但保留可撤销。
- 当 `p_know` 高且置信度高时，逐步停止标注和推荐。
- 复习调度使用 FSRS；掌握度和 FSRS 的 stability/difficulty 分开，前者服务界面，后者服务复习时间。

等真实数据积累后，再评估 BKT/IRT 或轻量序列模型。没有数据时上 DKT 只会制造不可解释的复杂度。

### 4.5 上下文遭遇

同一个词在不同语境下可能完全不同。每次遭遇至少记录：

- `video_id`、`file_hash`、`sentence_index`、`sentence_hash`。
- 原词形、lemma、所在短语。
- 句子上下文和视频标题/主题。
- 用户行为与时间。

这使词卡可以说：

> 你 3 周前在《xxx》里见过它，当时是「怨恨」；这里是「不愿意做某事」。

这比单纯显示「你收藏过」更有学习价值。

## 5. 上下文智能与推荐

### 5.1 每句话的 Context Pack

字幕加载后，为每个句子生成并缓存一个上下文包：

```text
ContextPack {
  sentenceHash
  tokens[]              // 原文、lemma、词性、位置
  contentWords[]        // 去掉停用词、专名、数字
  candidates[]          // 候选学习词
  comprehensionScore    // 用户理解这句话的概率估计
  topicEmbedding        // 句子主题向量
  learningMomentScore   // 是否值得在此处干预
  l1Help                // 是否需要中文辅助
}
```

实时路径只使用本地确定性结果，不调用 LLM。

### 5.2 候选词管线

```text
分词/lemma
  → 过滤停用词、专名、数字、缩略词
  → 查本地词典与 CEFR/词频
  → 排除 known / ignored
  → 计算候选特征
  → 排序并限制密度
  → 生成可解释理由
  → 投影到字幕和文稿
```

候选特征建议：

- `difficultyFit`：词难度与用户水平的匹配度，优先 i+1。
- `frequencyUtility`：词频与通用价值。
- `contextSalience`：是否影响本句理解，是否是搭配/短语的一部分。
- `personalNeed`：过去查过、错过、正在复习、即将遗忘。
- `topicRelevance`：与用户兴趣、当前视频主题的相关度。
- `interruptionCost`：提示会不会打断当前节奏。

第一版不需要复杂的机器学习，先用可解释的加权分数。上线后记录「展示 / 打开 / 收藏 / 忽略 / 7 天后回忆」做校准。

### 5.3 密度约束

这是产品体验的硬约束，不是可选优化：

- 主字幕默认不在普通句子上铺满下划线。
- 每句最多 1 个主动提示，每 10 分钟最多若干次「学习时刻」。
- 用户可切换提示强度：`关闭 / 安静 / 教练 / 强化`。
- 任何自动化提示都必须能一键关闭或降级。

### 5.4 LLM 的使用边界

LLM 不进入实时标注主路径。它只做异步、可缓存、可解释的增强：

- 结合当前句子的简明释义。
- 「为什么这个词在此刻值得学」。
- 同一词在不同语境下的差异解释。
- 视频结束后的摘要、复述、角色扮演。
- 学习者问题的上下文回答。

约束：

- 结构化输出，schema 校验。
- 词典和字幕作为 grounding，不让模型自由发明释义。
- 结果按 `sentenceHash + model + promptVersion` 缓存。
- 云端不可用时自动降级到本地词典和规则，不阻塞播放。

### 5.5 自适应字幕

利用「内容词已知率 + 句法复杂度 + 上下文向量」估计句子理解概率：

- 理解概率高：弱化或隐藏中文，鼓励直接理解。
- 理解概率低：保留中文，或只对关键词给出即时注释。
- 用户手动切换后，系统学习其偏好，不反复对抗。

这比简单地「隐藏中文字幕」更智能，也更符合 comprehensible input。

### 5.6 学习时刻检测

不是每一个生词都值得打断。学习时机可以综合：

- 目标词密度。
- 句子理解难度。
- 用户刚刚暂停、回听或打开词卡。
- 当前会话已经学了多少。
- 距离上次干预的时间。

高价值时机才提供 20–60 秒的微交互：复述、跟读、听写、选择释义。

### 5.7 内容指南针

用视频/句子向量、词表覆盖率和用户兴趣做内容推荐：

- 优先推荐「大部分能看懂，少量 i+1 词」的内容。
- 让到期复习词自然出现在下一部内容中。
- 推荐理由可解释：「这部片子里你正在学的 6 个词会反复出现」。

### 5.8 语音与表达

复用现有跟读/听写能力，再向前一步：

- 本地 ASR + 强制对齐做词级评分。
- 逐步增加重音、节奏、连读的反馈。
- 用 TTS 提供可对比的参考音。
- 不把发音分数当成唯一目标，优先鼓励可理解表达。

## 6. 交互重构

### 6.1 注释语法

| 状态 | 主字幕 | 右侧文稿 | 交互 |
| --- | --- | --- | --- |
| `learning` | 轻量下划线或底部细线 | 下划线 + 状态点 | 点击打开上下文词卡 |
| `familiar` | 默认不标记 | 弱提示，可筛选 | 悬停显示「有印象」 |
| `known` | 不标记 | 不标记 | 可撤销 |
| `ignored` | 不标记 | 不标记 | 可恢复 |
| `suggested` | 默认不标记 | 句末 chip 或侧栏提示 | 用户主动展开 |

关键变化：**系统建议不再直接画到正文上**。正文只表达用户的学习状态；推荐是另一层，低干扰地出现。

### 6.2 词卡

词卡顺序从「词典优先」改成「上下文优先」：

1. 当前句子，目标词高亮。
2. 这句话里的简明释义。
3. 为什么此刻提示：高频 / 你查过 / 即将遗忘 / 本句关键搭配。
4. 你与这个词的历史：上次遇见、上次复习、当前状态。
5. 一个可点击的例句或原视频片段。
6. 动作：加入学习、认识、忽略、朗读。

### 6.3 复习坞

不做独立的「背单词页面」作为主入口，而是在播放器内提供一个可收起的复习坞：

- 到期词以 3–5 个为一组。
- 先回忆，再揭示。
- 支持「认识 / 模糊 / 忘记」。
- 复习完可以一键回到刚才的视频位置。

### 6.4 AI 提示的四种强度

- `关闭`：只保留用户主动查词。
- `安静`：只标注 `learning`，不主动推荐。
- `教练`：每句最多 1 个建议，自然停顿处给微练习。
- `强化`：更积极的复习和口语任务，适合专门学习时段。

### 6.5 视觉语言

- 继续使用媒体层黑白体系，不让主题色污染视频画面。
- 学习状态用「形状 + 位置 + 弱色」表达，不只依赖颜色。
- 主字幕克制，右侧文稿承担更多信息密度。
- 动效只用于状态变化和自然停顿，不做持续闪烁。
- 支持 reduced motion。

## 7. 技术重构

### 7.1 后端服务边界

建议新增或演进以下服务：

- `LearnerProfileService`：水平、目标、兴趣、提示强度。
- `LexiconService`：只读词典/CEFR/词频/考试标签。
- `WordStateService`：单词状态、掌握度、手动纠正。
- `EncounterService`：事件采集、去重、批量写入。
- `LearningSessionService`：观看会话、学习统计、摘要。
- `RecommendationService`：候选生成、评分、密度约束、理由。
- `ReviewScheduler`：FSRS、到期队列、复习结果。
- `ContextIndexService`：句子/视频 embedding、向量检索。
- `AiLearningGateway`：结构化 LLM 调用、缓存、降级。
- `LearningConductor`：把上述能力编排成一次学习会话的后台流程。

现有服务尽量复用：

- `WordMatchService` → 继续负责词表匹配，但输出改为 `WordState`。
- `SubtitleVocabularyAnalysisService` → 扩展为 `ContextAnalysisService`，产出 ContextPack。
- `SentenceVocabularyService` → 作为候选生成器之一，不再直接定义 UI 高亮。
- `SentencePracticeService` → 把跟读/听写结果写入 Encounter 和 Mastery。
- `LocalAiService` / `AiProviderService` → 统一由 `AiLearningGateway` 路由。

### 7.2 前端状态边界

建议把「词表状态」升级为「学习者状态投影」：

- `learnerStore`：profile、word states、review due、guidance level。
- `annotationProjector`：把 ContextPack + WordState 投影成每个句子的注释。
- `encounterRecorder`：批量记录 hover/open/replay/save/known/ignore。
- `recommendationStore`：候选、理由、展示/忽略反馈。
- `sessionStore`：当前学习会话、干预预算、结束摘要。

`Word` 组件不再自己判断「是否在词表」，而是读取投影后的注释状态。这样主字幕和右侧文稿永远一致。

### 7.3 数据模型

建议新增：

```text
learner_profiles
  id, cefr_estimate, cefr_confidence, goals_json, interests_json,
  daily_target, guidance_level, created_at, updated_at

lexicon_entries
  id, lemma, display, phonetic, definitions_json, cefr, zipf,
  bnc_rank, collins, tags_json, source_version

user_word_states
  id, profile_id, lemma, status, source, p_know, confidence,
  first_seen_at, last_seen_at, mastered_at, updated_at

word_encounters
  id, profile_id, lemma, surface, video_id, file_hash,
  sentence_index, sentence_hash, action, context_json, created_at

learning_sessions
  id, profile_id, video_id, mode, started_at, ended_at, stats_json

review_cards
  id, user_word_state_id, due_at, state, reps, lapses,
  stability, difficulty, last_review_at

recommendations
  id, profile_id, video_id, sentence_hash, lemma, score,
  reason_json, action, created_at

context_embeddings
  id, scope, ref_id, model, dim, vector, created_at
```

原则：

- `lexicon_entries` 是可重建的只读数据，不属于用户。
- `user_word_states` 才是「我的词」。
- `dp_words` 迁移时保留兼容层，旧数据标记 `source=legacy`。
- 默认词表标记 `source=default`，默认不参与正文标注。
- `recommendations` 与 `user_word_states` 分库，推荐不能污染用户词表。

### 7.4 缓存与重算

- ContextPack 按 `fileHash + sentenceHash + modelVersion` 缓存。
- 推荐分数按 `sentenceHash + profileRevision + lexiconRevision` 缓存。
- WordState 更新后递增 `profileRevision`，只重算受影响的句子。
- LLM 结果按 `sentenceHash + promptVersion + model` 缓存。
- 实时注释路径不等待网络。

### 7.5 性能预算

- 字幕加载后首屏注释：本地 100ms 级。
- 单词状态切换：UI 立即反馈，后台异步落库。
- LLM 词卡增强：可取消，目标 2s 内出现骨架结果。
- 复习/推荐计算：后台任务，不阻塞播放。
- 所有 AI 功能都能降级到本地规则。

### 7.6 先进技术路线

不追求「所有模型都上」，而是按实时性分层：

- 实时层：wink NLP、本地词典、规则评分、纯函数注释投影。
- 语义层：本地 embedding（如 bge-small / e5-small 的 ONNX 版本）+ `sqlite-vec` 或等价本地向量索引，做句子/视频/兴趣相似度。
- 推理层：本地 llama.cpp 与云端模型统一走 `AiLearningGateway`，结构化输出、缓存、降级、成本预算都在这一层。
- 记忆层：透明的 Beta 掌握度 + FSRS；数据足够后再评估 BKT/IRT 或轻量序列模型。
- 语音层：复用 whisper.cpp / sherpa-onnx 与强制对齐，逐步加入重音、节奏、连读反馈。
- 多模态层：场景切分、说话人、韵律、画面语境作为 R3 的增强信号，不让它们进入首屏关键路径。
- 策略层：在积累足够的展示/接受/回忆数据后，再考虑 contextual bandit 选择「何时、用哪种微干预」，而不是一开始就用强化学习。

## 8. 分阶段路线图

### R0：真实与可控（2–3 周）

目标：先把「下划线到底是什么意思」修对，建立可继续演进的状态底座。

交付：

- 拆分 `lexicon_entries` 与 `user_word_states`，或至少为 `dp_words` 增加 `source/status`。
- 默认词表不再默认进入个人生词；已有数据做一次迁移标记。
- 主字幕/右侧文稿统一读取 `WordState` 投影。
- 四个状态 + 「认识 / 忽略」动作 + 状态说明 tooltip。
- 提示强度开关：关闭 / 安静 / 教练。
- 采集 encounter 事件，先落本地日志/表。
- 补迁移测试、注释一致性测试、密度守卫测试。

验收：

- 新用户不会因为默认词表看到大面积下划线。
- 同一个词在主字幕和右侧文稿状态一致。
- 用户能明确知道每个标记为什么出现，并能一键纠正。
- 现有收藏、导入、播放、练习功能不回归。

### R1：学习记忆（3–4 周）

目标：让系统真正记住「用户见过什么、学过什么、什么时候会忘」。

交付：

- `WordEncounter` 事件流与去重。
- `p_know + confidence` 的透明掌握度模型。
- FSRS 复习卡、到期队列、复习坞。
- 会话摘要：本次遇到的目标词、已掌握词、待复习词。
- 跟读/听写结果接入掌握度。
- 7 天/30 天回忆指标。

验收：

- 用户能看到「为什么这个词现在出现」。
- 复习完成会改变后续提示与复习时间。
- 不依赖云模型也能完整运行。
- 学习数据可导出、可删除。

### R2：上下文智能（4–6 周）

目标：从「用户词表匹配」升级为「基于上下文的个性化建议」。

交付：

- ContextPack 与候选评分。
- 每句最多 1 个建议、可解释理由、密度约束。
- 自适应中文字幕。
- LLM 词卡增强、摘要、复述，带缓存和本地降级。
- 句子/视频 embedding 与兴趣相关度。
- 内容指南针第一版：按难度与兴趣推荐下一段内容。

验收：

- 推荐接受率、忽略率、7 天回忆率可观测。
- 关闭 AI/断网时，播放器和本地标注正常工作。
- 推荐密度不会破坏阅读体验。
- 每条建议都能说明理由。

#### R2 第一阶段实施记录（2026-11-12）

已落地：

- 每句话生成本地确定性 ContextPack：分词、词表命中、复习到期、历史查词/收藏和考纲标签共同参与候选评分。
- 教练模式每句最多展示 1 个建议，位于字幕下方而不是正文内；关闭和安静模式不请求建议。
- 建议展示稳定理由代码，前端按语言渲染「为什么是它」；不使用 LLM，不依赖网络。
- 密度约束包含最低分数、全局 90 秒冷却、同词 10 分钟冷却、新词忽略后 14 天抑制。
- 展示、展开、加入学习和忽略都会写入 WordEncounter，作为后续个性化反馈证据。
- 已在学习清单的词显示「已在学习清单」，不重复提供「加入学习」；「先忽略」只隐藏当前句建议，不改变用户词表状态。

核心实现：

- `src/common/types/contextPack.ts`、`src/common/learning/contextRecommendation.ts`
- `src/backend/services/ContextPackService.ts`
- `src/common/api/api-def.ts` 的 `vocabulary/context-pack`
- `src/fronted/features/player/components/srt-layout/ContextSuggestionChip.tsx`

验证：

- 推荐评分、ContextPack 服务和建议 chip 的定向测试共 16 项通过。
- R2 涉及文件定向 ESLint 通过。

尚未包含：

- LLM 词卡增强、摘要与复述。
- 句子/视频 embedding、内容指南针。
- 推荐接受率、忽略率和 7 天回忆率的聚合看板；当前先落事件证据，指标聚合留到下一阶段。

#### R2 第二阶段实施记录（2026-11-12）

已落地：

- 自适应中文字幕首版：本地估算句子理解度，不调用模型、不访问网络。
- 理解度特征包括内容词已知率、句长、从句标记与长词比例；用户 `known / familiar / learning` 状态与掌握度优先于词典难度。
- `high` 只把中文透明度降到 50%，`medium` 降到 72%，`low` 保持 100%；不隐藏文本、不改变布局，悬停字幕或键盘聚焦时立即恢复完整显示。
- 新增「自适应中文」运行时开关，默认开启；关闭后始终完整展示中文，不发起理解度请求。
- 同时修复运行时设置保存白名单遗漏 `player.vocabularyGuidance` 与 `player.adaptiveChinese` 的问题。

核心实现：

- `src/common/learning/comprehension.ts`
- `src/common/learning/contentWords.ts`
- `src/backend/services/SubtitleComprehensionService.ts`
- `src/backend/controllers/SubtitleController.ts` 的 `subtitle/comprehension`
- `src/fronted/features/player/components/srt-layout/AdaptiveChineseLine.tsx`

验证：

- 完整单元/组件测试：825 项通过，9 项跳过。
- TypeScript 全量检查通过。

尚未包含：

- 上下文向量与真实学习者水平校准；当前只使用本地确定性特征。
- 用户手动切换后自动学习偏好；当前由显式开关控制。
- 完全隐藏中文；首版只做可逆的视觉弱化。

#### R2 第三阶段实施记录（2026-11-12）

已落地：

- 词卡内新增按需「AI 语境解读」：默认只保留一行次级入口，用户点击后才请求，悬浮查词与字幕加载不触发推理。
- 输出限定为两个短字段：「在这句话里的含义」与一句语境说明（词性角色、搭配、语气或易混淆点）；不翻译整句、不展开语法课。
- 本地词典释义始终先行展示；AI 区块独立加载、失败或模型未就绪时只在区块内降级，不影响查词、收藏与播放。
- 可用性遵循词典引擎设置：`openai` 引擎优先云端，云端失败或超时后回退本地就绪模型；`local` 引擎只走本地；`none` 时不展示入口。
- 缓存键覆盖单词、整句哈希、词卡释义、引擎与两端模型 id、提示词版本；进程内 LRU 上限 128 条、TTL 7 天，同一语境并发请求合并为一次推理。
- 结构化输出经 Zod 校验；本地模型返回非法结构时显式失败且不写缓存，避免坏结果长期驻留。

核心实现：

- `src/common/types/wordInsight.ts`
- `src/backend/services/WordContextInsightService.ts`
- `src/backend/controllers/AiTransController.ts` 的 `ai-trans/word-insight`
- `src/fronted/features/player/components/translatable-line/word-context-insight.tsx`

验证：

- 语境解读服务 7 项测试通过（缓存命中、跨句隔离、云端回退、非法结构、并发去重、可用性、提示词）。
- 词卡区块 4 项组件测试通过（渐进披露、AI 关闭、模型未就绪、失败重试）。
- 中英文案 parity 测试 23 项通过。
- TypeScript 全量检查通过，定向 ESLint 通过。

尚未包含：

- 整句 AI 摘要与复述；当前只做单词级语境解读。
- 句子/视频 embedding 与内容指南针。
- 推荐接受率、忽略率与 7 天回忆率的聚合看板。

#### R2 第四阶段实施记录（2026-11-12）

已落地：

- 「本次学习」摘要弹层新增克制的复盘入口，用户主动打开后才请求模型，不在视频结束或悬浮路径自动生成。
- AI 复盘输出 2–3 个词、1 个真实字幕句、1 个实用表达与 1 个 20–60 秒口语任务；词只能来自本次会话，句子必须与字幕原文逐字一致，表达必须真实出现在字幕里，越界内容自动丢弃或用本地词补齐。
- 复盘始终有本地确定性版本：按到期、学习中、收藏优先选词，并优先选择与最值得记的词同句的字幕；AI 关闭、断网或输出不合法时只降级复盘内容，不阻塞入口。
- 新增书面「一句话复述」：本地先计算原句内容词覆盖率、缺失关键词与等级；AI 在同等关键词事实基础上补充具体点评与更自然的英文改写，云端失败自动回退本地就绪模型。
- 复盘缓存按会话定位、会话词句、语言、模型与提示词版本隔离；复述缓存按原句、用户答案、语言与模型隔离。两者都做并发去重，复盘 TTL 1 小时、复述 TTL 7 天。

核心实现：

- `src/common/types/learningRecap.ts`
- `src/backend/services/LearningRecapService.ts`
- `src/backend/controllers/LearningDataController.ts` 的 `learning-data/recap` 与 `learning-data/retell-feedback`
- `src/fronted/features/player/components/learning-toolbar/LearningRecapDialog.tsx`
- `src/fronted/features/player/components/learning-toolbar/LearningSessionDock.tsx`

验证：

- 复盘服务 8 项测试通过（会话事实约束、缓存、AI 缺失、云端失败、并发去重、复述覆盖、AI 复述、提示词）。
- 复盘弹层 4 项组件测试与「本次学习」入口测试通过。
- 全量单元/组件测试：851 项通过，9 项跳过。
- TypeScript 全量检查通过，定向 ESLint 通过。

尚未包含：

- 视频结束自动提示复盘；当前由用户从「本次学习」主动打开，避免打断连续播放。
- 语音复述与发音/流利度评分；当前只做书面复述。
- 复述结果写入掌握度与长期学习指标；当前只作为即时练习反馈。

#### R2 第五阶段实施记录（2026-11-12）

已落地：

- 首页新增低干扰「内容指南针」：位于快速开始与最近观看之间，只展示媒体库中有可用字幕的视频；推荐失败、无候选或无可解析字幕时整段静默隐藏。
- 推荐完全本地、确定性执行：不调用模型、不下载 embedding、不访问网络。字幕按均匀抽样最多 30 行，单文件上限 2 MB，分析结果做 64 条 LRU 缓存。
- 候选先按媒体目录轮转排序，再逐条解析字幕直到凑满 12 个有效候选；不会因为前序视频没有字幕而提前返回空结果。
- 排序由四个可解释信号组成：理解度契合 44%、到期词复现 30%、学习中/熟悉词复现 16%、最近观看主题词相似 10%；理解度低于 0.35 时整体降权 25%。
- 理解度复用自适应中文字幕的本地估算器，并把词典难度映射抽到共享服务，保证首页推荐与播放器内理解度口径一致。
- 每张推荐卡展示本地理解度、推荐理由、封面与打开入口；理由只暴露证据（到期词、学习词、主题相近或难度合适），不展示内部评分。
- 支持「不感兴趣」即时移除；同一视频同一自然日只上报一次曝光，避免打开首页反复刷高曝光量。
- 新增 `dp_recommendation_event` 与迁移 `0017_content_compass_recommendations.sql`，记录 `shown / opened / dismissed`、分数、理由代码与来源界面；推荐事件独立存放，不反向污染词表或学习状态。
- 设置页学习数据区新增推荐效果看板：最近 7 天曝光、打开率、忽略率，以及同窗口内 `Good + Easy` 的复习回忆率；加载中显示占位，无曝光时给出解释而不是零值噪声。
- 学习数据导出增加推荐事件；清除学习记录时同步删除推荐反馈。推荐事件只保留聚合所需字段，不存储字幕内容。

核心实现：

- `src/common/types/contentCompass.ts`、`src/common/learning/contentCompass.ts`
- `src/backend/services/ContentCompassService.ts`、`src/backend/services/dictionaryDifficulty.ts`
- `src/backend/controllers/ContentCompassController.ts`
- `src/backend/infrastructure/db/tables/recommendationEvent.ts`
- `drizzle/migrations/0017_content_compass_recommendations.sql`
- `src/fronted/features/content-compass/ContentCompassSection.tsx`
- `src/fronted/features/file-browser/HomePage.tsx`、`src/fronted/features/settings/StorageSetting.tsx`

验证：

- 全量单元/组件测试：865 项通过，9 项跳过。
- 推荐排序、候选字幕回退、事件汇总、导出/清除与首页组件定向测试共 44 项通过。
- TypeScript 全量检查通过，R2 涉及文件定向 ESLint 零告警。

#### R2 第六阶段实施记录（2026-11-12）

已落地：

- 新增本地主题向量索引 `searchTopicVectors`：条目入库前统一 L2 归一化，检索按余弦相似度降序，维度不一致的条目直接跳过，避免不同来源向量混算。
- 内容指南针不再对每部近期视频各算一次不同维度的词频余弦，而是先把候选与近期视频投影到同一共享词表空间，再走统一索引检索；兴趣分仍是多部近期视频相似度的均值。
- 新增服务级测试：已观看的视频会提升同主题候选的 `interest`，而无关主题候选不会获得同样的提升。

核心实现：

- `src/common/learning/topicIndex.ts`
- `src/common/learning/contentCompass.ts`（向量归一化与兴趣分聚合）
- `src/backend/services/ContentCompassService.ts`

验证：

- 主题索引 4 项、排序 7 项、内容指南针服务 6 项定向测试通过。

#### R2 第七阶段实施记录（2026-11-12）

已落地：

- 新增可选的本地语义模型 `bge-small-en-v1.5-q8_0`（35 MB，384 维，固定 SHA256），与对话模型完全隔离：独立下载、独立 llama-server 进程、独立空闲卸载。
- 内容指南针优先使用语义向量判断「最近观看主题是否相近」；模型未安装、运行时缺失或推理失败时整体降级为共享词表空间的词面相似度，不会出现部分语义、部分词面的混算。
- 主题文本由抽样字幕的内容词构成；近期视频只保留词频时按高频词拼接，保证同一向量空间内可比较。
- 向量服务按文本内容做进程内缓存（上限 256 条），同一视频重复打开首页不会重复推理。
- 设置页「本地增强资源包」新增可选安装入口，安装后无需切换「使用中模型」，也不会出现在对话模型列表里。
- 语义运行时默认惰性启动，空闲 5 分钟自动卸载；模型未安装时连进程都不会拉起。

核心实现：

- `src/common/contracts/local-ai.ts` 的 `LOCAL_EMBEDDING_MODEL`
- `src/backend/infrastructure/ai/LocalEmbeddingRuntime.ts`
- `src/backend/services/TopicEmbeddingService.ts`
- `src/backend/controllers/LocalAiController.ts`
- `src/fronted/features/settings/components/EmbeddingModelCard.tsx`

验证：

- 真实模型端到端验证：批量文本返回 2 × 384 维向量，本地进程冷启动约 0.3 秒。
- 语义运行时降级、尺寸不符、空输入 3 项测试通过；向量缓存与顺序保持 4 项通过；内容指南针语义分支 7 项通过。
- 全量单元/组件测试：993 项通过，9 项跳过；TypeScript 全量检查与 ESLint 零告警。

尚未包含：

- 持久化向量库与增量索引；当前样本量是最近 5 部视频，线性扫描足够，且不引入 `sqlite-vec` 依赖。
- 语义模型下载进度条；当前只展示安装中状态，35 MB 体积下收益有限。
- 在线学习或 bandit 调参；当前权重是透明常量，先积累曝光、打开与复习结果。
- 推荐 → 观看 → 复习的因果归因与长期留存实验；当前只统计同窗口相关指标，不宣称因果。
- 学习数据导入/恢复与跨设备同步；当前只提供 JSON 导出。

### R3：沉浸式学习 OS（6–8 周）

目标：把「看、学、练、复习、选内容」连成一个自然循环。

交付：

- 学习时刻检测与自然停顿微练习。
- 跟读的重音/节奏反馈。
- 场景化角色扮演与复述。
- 个人记忆图谱/主题图谱。
- 内容推荐与到期复习词联动。
- 可选的本地多模态：场景切分、说话人、语音韵律。

验收：

- 用户一周内能完成「观看 → 注意 → 回忆 → 表达 → 复习」闭环。
- 学习行为不是靠弹窗和打卡驱动。
- 关键路径本地可用，云端只做增强。
- 每个 AI 功能都有明确的关闭开关和降级路径。

#### R3 第一阶段实施记录（2026-11-12）

已落地：

- 主字幕下方新增「学习时刻」提示位，与原有的上下文词建议共用同一个位置，二者不同时出现，避免字幕下方堆叠操作。
- 只在用户暂停并停留至少 5 秒后检测；播放中、安静/关闭模式或当前句没有到期学习词时完全不出现。
- 到期词来自现有 ContextPack 候选，要求状态为 `learning / familiar`、已到期且掌握度低于 0.6；优先选择最早到期的词。
- 微回忆遵循「先回忆、再揭示」：先展示单词与音标，用户主动揭示释义后，用「想起来了 / 没想起来」二档反馈映射到 `good / again`，复用现有复习调度与掌握度证据链。
- 密度约束全在本地：同一句 30 分钟内不重复、任意两次至少间隔 5 分钟、单次播放会话最多 3 次；限频记忆按播放会话持久化，不因组件重挂载而重置。
- 缓存键与 ContextPack 建议一致，暂停检测不会额外发起重复分析；所有决策不调用模型、不访问网络，也不改变用户词表状态。
- 新增独立 `moment` i18n 命名空间，中英文案完整对齐。

核心实现：

- `src/common/learning/learningMoment.ts`
- `src/fronted/features/player/components/srt-layout/SubtitleLearningHints.tsx`
- `src/fronted/features/player/components/srt-layout/LearningMomentChip.tsx`
- `src/fronted/features/player/components/srt-layout/MainSubtitle.tsx`
- `src/fronted/i18n/locales/{zh-CN,en-US}/moment.json`

验证：

- 学习时刻决策、提示 chip、暂停接入与中英文案 parity 定向测试 42 项通过。
- 全量单元/组件测试：880 项通过，9 项跳过。
- TypeScript 全量检查通过，全量 ESLint 零告警。

尚未包含：

- 回听、打开词卡、跟读失败等更多学习时刻信号；首版只使用「暂停停留 + 到期词」。
- 跟读重音/节奏；仍属于 R3 后续阶段。
- 学习时刻曝光与忽略的独立分析事件；当前限频在本地完成，先不做服务端归因。

#### R3 第二阶段实施记录（2026-11-12）

已落地：

- 学习复盘新增书面「场景回应」：以本次会话真实字幕句作为对方开场白，展示场景说明、回应提示与最多 3 个目标表达。
- 场景与提示词由模型在会话事实内生成；开场白必须与真实字幕句归一化后完全一致，目标表达必须逐字出现在开场白中，越界时整段回退本地场景，不阻断复盘。
- 回应检查复用现有复盘链路：目标表达使用情况始终由本地逐字匹配，模型只补充等级、点评与更自然的回应。
- 云端失败后尝试本地模型，仍失败则返回本地长度/表达信号；明确不把回应长度伪装成语义评分。
- 场景回应结果按「场景 + 开场白 + 回应 + 目标表达 + 语言 + 模型 + 提示词版本」缓存 7 天，并做并发去重。
- 草稿修改会立即使旧反馈失效；重新生成复盘时清空场景草稿与结果。
- 未新增弹窗层级、不自动播放音频、不自动请求模型。

核心实现：

- `src/common/types/learningRecap.ts`
- `src/backend/services/LearningRecapService.ts` 的 `evaluateRolePlay`
- `src/backend/controllers/LearningDataController.ts` 的 `learning-data/role-play-feedback`
- `src/fronted/features/player/components/learning-toolbar/LearningRecapDialog.tsx`
- `src/fronted/i18n/locales/{zh-CN,en-US}/recap.json`

验证：

- 复盘服务、复盘弹层与中英文案 parity 定向测试 47 项通过。
- 全量单元/组件测试：921 项通过，9 项跳过。
- TypeScript 全量检查通过，全量 ESLint 零告警。

尚未包含：

- 语音角色扮演与发音/流利度评分；当前只做书面回应。
- 多轮角色扮演对话；当前只针对一个开场白做一次回应。
- 场景回应结果写入长期表达掌握度；当前只作为即时练习反馈。

#### R3 第三阶段实施记录（2026-11-12）

已落地：

- 录音跟读在原有词级对齐评分之外，新增本地「节奏与重读」反馈：展示语速倍率、逐词时长分布与最多两个明显重读的词。
- 信号完全本地、确定性：复用本地 ASR 子词时间轴与 ffmpeg 生成的 16kHz 单声道 PCM，计算逐词能量峰值与相对重读；不调用模型、不访问网络。
- 只做相对比较：重读判定基于同段录音内的能量分布；虚词不参与重读候选，避免把功能词误标成重音。
- 语速以原句音频时长为参考，偏快/偏慢/接近原速使用透明阈值；没有参考时长或时间轴时只展示可用的部分。
- 节奏是附加信号：WAV 解析失败、时间轴缺失或分析异常时返回 `null`，跟读评分与录音留存不受影响。
- 听写结果不携带节奏字段；未安装 ASR 的纯声纹对比路径行为不变。
- UI 复用现有声学反馈条，不新增面板层级；逐词节奏以行内文字呈现，重读词加粗下划线，漏词弱化并加删除线。

核心实现：

- `src/common/utils/practice/rhythmFeedback.ts`
- `src/common/contracts/sentence-practice.ts`
- `src/backend/services/SentencePracticeService.ts`
- `src/fronted/features/practice/components/ShadowingStudio.tsx`
- `src/fronted/i18n/locales/{zh-CN,en-US}/practice.json`

验证：

- 节奏解析、重读判定、缺失词与服务集成定向测试 16 项通过。
- 全量单元/组件测试：931 项通过，9 项跳过。
- TypeScript 全量检查通过，全量 ESLint 零告警。

尚未包含：

- 音素级发音评分与具体音标纠错；当前只分析时长与能量，不判断音素是否正确。
- 原句参考重音标注；当前重读是用户自身录音内的相对分布，而不是与母语者重音位置对比。
- 跨次练习的节奏趋势；当前只展示单次结果。

#### R3 第四阶段实施记录（2026-11-12）

已落地：

- 词汇工坊新增可折叠「记忆图谱」，按真实视频主题聚合用户词，并按 `learning / familiar / known / ignored` 四个记忆阶段展示分布。
- 主题键优先使用词遭遇事件里的 `videoId`，主题名取观看记录文件名并去掉扩展名；只有字幕哈希时使用独立主题，不把哈希伪装成标题。
- 没有任何视频上下文的词进入「还没有上下文的词」，手动添加或更早的记录不会从图谱里消失。
- 主题内最多展示 8 个代表词，排序固定为「已到期 → 学习中 → 熟悉 → 已掌握 → 已忽略」，同优先级按最近遇见时间倒序。
- 每个主题显示阶段分布条与代表词；已到期词使用警示色，已掌握词使用成功色。点击词直接筛选词汇工坊的片段。
- 默认词表不进入图谱，也不计入总词数；没有用户词时整段隐藏。
- 全程只读本地词表、遭遇事件、复习卡与观看记录，不调用模型、不访问网络。

核心实现：

- `src/common/types/memoryMap.ts`、`src/common/learning/memoryMap.ts`
- `src/backend/services/MemoryMapService.ts`
- `src/fronted/features/learning-data/MemoryMapSection.tsx`
- `src/fronted/features/video-learning/VideoLearningPage.tsx`
- `src/fronted/i18n/locales/{zh-CN,en-US}/memoryMap.json`

验证：

- 记忆图谱聚合、到期排序、无上下文兜底、默认词表排除与组件交互定向测试 7 项通过。
- 全量单元/组件测试：940 项通过，9 项跳过。
- TypeScript 全量检查通过，全量 ESLint 零告警。

尚未包含：

- 词与词之间的共现边、聚类主题命名与图谱可视化布局；当前是主题分组 + 阶段分布。
- 跨设备的图谱同步；当前只读本机数据库。
- 点击图谱词后的主题内连续学习队列；当前复用词汇工坊既有的片段筛选。

#### R3 第五阶段实施记录（2026-11-12）

已落地：

- 内容指南针的到期词理由从「只展示数量」升级为可执行闭环：含到期词的推荐卡直接展示具体词，并提供「复习这 N 个到期词」入口。
- 点击复习入口不跳转视频、不打断当前内容，只向播放器学习台发出一次性打开复习坞请求；复习 UI 仍只有一套。
- 新增跨页面 `reviewDockStore`，用「请求序号 / 已消费序号」表达一次性意图，避免 effect 内 setState 与重复弹层。
- 推荐事件新增 `reviewed` 动作，并记录 `due_review` 理由；推荐看板新增「进入复习」次数与复习转化率。
- 复习转化率分母只统计带到期词理由的曝光，避免把普通推荐算进分母。
- 推荐卡在复习入口旁展示具体到期词，用户点击前就能知道会复习什么。

核心实现：

- `src/common/types/contentCompass.ts`
- `src/backend/services/ContentCompassService.ts`
- `src/fronted/features/content-compass/ContentCompassSection.tsx`
- `src/fronted/features/player/components/learning-toolbar/reviewDockStore.ts`
- `src/fronted/features/player/components/learning-toolbar/ReviewDock.tsx`
- `src/fronted/features/settings/StorageSetting.tsx`

验证：

- 推荐统计口径、复习入口、跨页请求消费与看板展示定向测试 9 项通过。
- 全量单元/组件测试：944 项通过，9 项跳过。
- TypeScript 全量检查通过，全量 ESLint 零告警。

尚未包含：

- 「推荐 → 打开视频 → 视频内复习 → 次日回忆」的完整因果归因；当前只记录推荐到复习的点击。
- 按复习结果反向调整推荐权重；当前排序仍使用到期词数量与理解度等本地信号。
- 非首页场景（播放器内推荐、移动端）的复习联动入口。

#### R3 第六阶段实施记录（2026-11-12）

已落地：

- 新增纯本地的确定性场景切分 `segmentScenes()`：只用字幕时间与文本，不请求模型、不读取画面。
- 三类边界信号：静默间隔 ≥ 2.5s（`time-gap`）、左右各 3 句窗口的内容词 Jaccard ≤ 0.02（`topic-shift`）、问句后紧跟短回应（`speaker-shift`）。
- 置信度 0–1 只表达本地信号强弱，不代表模型判断；两侧内容词不足 3 个时不做话题判断，避免把正常换句误判成换场。
- 主字幕区新增极轻提示：仅当开关开启且当前句正好落在边界上时，在字幕上方出现一枚胶囊标签；绝对定位、不参与排版，不改变中英文字幕的居中位置，也不因提示出现/消失产生抖动。
- 新增设置键 `player.sceneCues`，默认 `false`；在播放控制快速面板中可即时开关，无需重启。
- 提示文案区分「新场景 · 话题切换」与「可能换了说话人」；后者是启发式推测，措辞上不声称已完成说话人识别。

核心实现：

- `src/common/learning/sceneSegmentation.ts`
- `src/fronted/features/player/components/srt-layout/SceneCue.tsx`
- `src/fronted/features/player/components/srt-layout/MainSubtitle.tsx`
- `src/common/types/store_schema.ts`
- `src/common/contracts/runtime-settings.ts`
- `src/backend/services/SettingService.ts`
- `src/fronted/features/player/components/learning-toolbar/PlayerSettingsPopover.tsx`

验证：

- 场景切分定向测试 5 项、场景提示组件测试 3 项、播放面板测试 6 项，共 14 项通过。

尚未包含：

- 视频帧理解与画面场景识别；当前完全不用图像信号。
- 声纹分离与精确 diarization；现有字幕数据没有 speaker 元数据，只能给出「可能换了说话人」。
- 语音韵律（重音、语调）作为场景信号；当前只覆盖跟读环节的节奏反馈。
- 场景切分结果的持久化与跨会话复用；当前按当前字幕数组在渲染进程内计算。

#### R3 第七阶段实施记录（2026-11-12）

已落地：

- 修复导出与清除的不对称：此前「清除学习记录」会删除跟读、听写与复述/角色扮演记录，但导出只包含词表、遭遇事件、复习卡与推荐事件，导出的 JSON 并不能恢复被清掉的内容。
- 导出 schema 升到 `schemaVersion: 2`，补齐 `sentencePractices`（跟读/听写）与 `productionPractices`（复述/角色扮演）两组记录；旧备份仍可读，缺失字段按空数组处理。
- 新增「导入学习数据」：设置 → 存储 → 学习数据中可直接从 JSON 备份恢复，先确认再执行，取消文件对话框不报错。
- 导入先做完整结构校验（枚举、数值、必填、重复词条与重复复习卡），通过后才在单个事务里整体替换；任何一步失败都回滚，不会留下半套数据。
- 恢复语义是「快照覆盖」而不是合并：已删除的事件不会被旧备份复活，掌握度也不会出现无法解释的混合值。
- 内置默认词表不随备份进出；若备份里有同形词，导入后该词归属用户（`source=manual`），避免撞唯一约束。
- 导入完成后递增字幕重载令牌，播放器重新解析并重新匹配词表，字幕标注立即反映恢复结果，无需切换视频。
- 版本高于当前支持的备份会被明确拒绝，而不是用旧代码写入它不理解的字段。

核心实现：

- `src/common/learning/learningDataSnapshot.ts`
- `src/common/types/learningData.ts`
- `src/backend/services/LearningDataService.ts`
- `src/backend/services/repositories/LearningDataRepository.ts`
- `src/backend/infrastructure/db/repositories/LearningDataRepositoryImpl.ts`
- `src/backend/controllers/LearningDataController.ts`
- `src/fronted/features/settings/StorageSetting.tsx`

验证：

- 导出完整性、导入往返、默认词表保留与同名词覆盖、坏备份拒绝等 11 项定向测试通过。
- 全量单元/组件测试：1017 项通过，9 项跳过。
- TypeScript 全量检查通过，全量 ESLint 零告警。

尚未包含：

- 跨设备同步与冲突合并；导入是整体覆盖，不做字段级 merge。
- 音频文件本体的搬迁；跟读录音只保留相对路径，换机恢复后需自行拷贝 practice 目录才能回放。
- 备份的加密与签名；当前是明文 JSON，不含任何密钥。

#### R3 第八阶段实施记录（2026-11-12）

已落地：

- 新增持久化主题向量索引表 `dp_topic_vector`：按 `video_id + model` 唯一，向量以 Float32 BLOB 存储（768 维约 3 KB，而 JSON 约 9 KB）。
- 主题向量检索改为三级命中：进程内缓存 → 持久化索引 → 批量推理。重启后不再对同一视频重复推理。
- 索引键包含主题文本哈希：字幕重新切分或时间轴校准导致文本变化时，旧向量自动失效并重算，不会按 `video_id` 盲目复用。
- 不同模型的向量按 `model` 隔离；维度不一致的条目在读取时被拒绝，绝不让两个向量空间的向量互相比较。
- 索引按「当前候选 + 近期视频」自愈：观看记录被删除或视频被移走后的陈旧条目会在下一次推荐时清理，不必在删除路径上追加跨服务调用。
- 索引读写失败都只降级为「下次重新推理」，不影响推荐结果，也不阻断播放。
- 新增场景切分持久化表 `dp_scene_index`：按 `file_hash + algorithm_version` 唯一，存输入指纹与边界 JSON。
- 场景切分从「每次渲染在前端重算」改为「后端按指纹复用」：首次进入某部视频计算一次，之后直接命中索引。
- 输入指纹只包含影响判定的字段（序号、起止时间、文本），译文与翻译分组变化不会造成无谓失效。
- 算法版本参与唯一键：调整阈值后旧结果自动失效，不会读到旧阈值的结果却以为是最新。
- 场景切分输入类型收敛为 `SceneSentence`（5 个字段），跨进程传输不再携带译文与翻译分组。
- 场景索引损坏或读取失败时静默重算；前端请求失败则静默隐藏提示，不回退到前端重算，避免两条实现逐渐漂移。

核心实现：

- `src/backend/infrastructure/db/tables/topicVector.ts`、`sceneIndex.ts`
- `src/backend/infrastructure/db/repositories/TopicVectorRepositoryImpl.ts`、`SceneIndexRepositoryImpl.ts`
- `src/backend/services/TopicEmbeddingService.ts`（三级命中与自愈清理）
- `src/backend/services/SceneIndexService.ts`
- `src/common/learning/vectorCodec.ts`、`sceneIndexKey.ts`
- `src/fronted/features/player/components/srt-layout/SceneCue.tsx`
- 迁移 `0019_calm_norrin_radd.sql`、`0020_steep_raider.sql`

验证：

- 向量仓储 BLOB 往返、唯一键更新、模型隔离、批量读取与范围删除 5 项通过。
- 场景索引仓储读写、版本隔离与按文件删除 3 项通过。
- 主题向量三级命中、文本变化失效、维度不符重算、`forget` 清理 8 项通过。
- 场景索引缓存命中、指纹失效、坏 JSON 重算、读取失败降级、哈希不一致跳过 7 项通过。
- 场景提示组件改为异步后端调用后的 5 项组件测试通过。
- 全量单元/组件测试：1045 项通过，9 项跳过。
- TypeScript 全量检查通过，全量 ESLint 零告警。

尚未包含：

- 向量索引的 ANN 近似检索；当前样本量是最近若干视频，线性扫描足够，未引入 `sqlite-vec` 或 HNSW。
- 场景切分使用视频帧与声纹；仍只用字幕时间与文本，属于确定性启发式。
- 向量索引随学习数据备份导出/恢复；向量可由字幕重新生成，未纳入备份。

### 8.1 第一个 Sprint 的具体任务

1. 明确 `WordState` 状态机与迁移策略。
2. 给 `dp_words` 增加 `source/status` 或建立新表与兼容层。
3. 把 `Word` 组件的高亮判定改为读取注释投影。
4. 增加「认识 / 忽略」动作与词卡说明。
5. 增加提示强度设置。
6. 记录 hover/open/replay/save 事件。
7. 写默认词表迁移测试与主/右文稿一致性测试。
8. 用 Playwright 覆盖「新用户不出现默认词表下划线」和「状态切换实时生效」。

#### 8.1 收尾记录（2026-11-12）

上述 8 项已全部具备可验证证据：

- `WordState` 状态机、`source/status` 字段与默认词表迁移由 `defaultVocabularySourceMigrationV1` 及对应测试覆盖。
- 主字幕与右文稿共用 `Word` 组件与同一注释投影；新增一致性测试锁定「右文稿不得自行判定注释」。
- 提示强度、认识/忽略动作与词卡说明已落地。
- 补齐此前从未上报的两类事件：`hover`（按词与句 60 秒节流）与 `replay`（整句重播时只记内容词）。
- 新增 Playwright 用例 `[SET-VOC-01]` / `[SET-VOC-02]`，覆盖新用户无默认词表下划线与状态切换后重新投影；用例文档见 `qa/test-cases/vocabulary-annotation.md`。

同时修复一处会阻断新用户首次启动的缺陷：`seedDefaultVocabulary` 曾在 better-sqlite3
同步事务里传入 async 回调，播种阶段直接抛「Transaction function cannot return a promise」，
主窗口永不出现。现改为同步事务 + 显式 `.run()`，并抽出
`src/backend/startup/defaultVocabularySeed.ts` 用真实内存库做回归测试。

尚未包含：

- `lookup` 事件仍无独立调用点；当前「打开词卡」与「查词」共用 `open`，避免同一动作重复计数。
- 悬停节流为进程内状态，跨重启不保留；这是有意的，避免把一次浏览拆成多条长期证据。

## 9. 指标与实验

### 9.1 北极星指标

建议用「每周完成真实回忆的目标词数」而不是观看时长或点击量：

```text
每周至少一次成功回忆（7 天后）的 learning 词数
```

辅助指标：

- 7 天 / 30 天词汇留存率。
- 复习到期完成率。
- 推荐展示 → 打开 → 收藏的转化率。
- 「认识 / 忽略」反馈率。
- 每 10 分钟主动干预次数。
- 学习会话结束后继续观看的比例。

### 9.2 体验护栏

- 每 100 个 token 的标记密度。
- 每 10 分钟主动提示次数。
- 词卡打开到关闭的时间。
- AI 响应 P95 延迟。
- CPU/GPU 占用与电量影响。
- 用户关闭 AI 功能的比例。

### 9.3 实验

- 下划线 vs 侧栏状态点 vs 不标记。
- 「安静 / 教练 / 强化」三种提示强度的留存差异。
- 有理由的推荐 vs 无理由推荐。
- 复习坞 vs 独立复习页。
- 自适应字幕 vs 固定双语字幕。

实验必须本地可关闭，默认保护学习心流。

## 10. 风险与边界

- **过度打扰**：AI 能力越多，越需要密度预算和自然停顿检测。
- **伪个性化**：没有数据时不要假装精准；先做透明规则，再逐步学习。
- **模型幻觉**：释义必须由词典和上下文约束；模型只做解释和组织。
- **隐私**：学习记录默认本地；云同步/云推理必须显式授权。
- **成本与延迟**：实时路径坚持本地，LLM 只做异步增强。
- **数据迁移**：旧词表不能丢；默认词表要能识别并降级为 starter pack。
- **指标异化**：不要把「AI 使用次数」当成学习效果。

需要产品上明确拍板的几个问题：

1. 是否支持多学习者 profile，还是先只做单本地用户？
2. 默认词表是「可选 starter pack」还是彻底移除？
3. 云 AI 默认关闭还是首次引导时选择？
4. 是否保留游戏化？建议只做轻量进度，不做惩罚性 streak。
5. 学习数据导出格式与跨设备同步是否进入近期范围？

## 11. 与现有代码的映射

### 11.1 复用

- `src/backend/services/WordMatchService.ts`：保留词表匹配能力，输出改为状态查询。
- `src/backend/services/SubtitleVocabularyAnalysisService.ts`：升级为上下文分析管线。
- `src/backend/services/SentenceVocabularyService.ts`：保留为候选生成器，移除「直接决定 UI 高亮」的职责。
- `src/backend/services/SentencePracticeService.ts`：把练习结果写入 Encounter/Mastery。
- `src/backend/services/VocabularyService.ts`：拆分为用户词状态与导入/导出。
- `src/backend/services/LocalAiService.ts`、`AiProviderService.ts`：统一到 AI Gateway。
- `src/fronted/features/player/components/translatable-line/word.tsx`：改为读取投影状态。
- `src/fronted/features/player/components/srt-layout/sentence-token-renderer.tsx`：复用同一状态投影。
- `src/fronted/features/practice/PracticePanel.tsx`：接入复习坞/学习时刻。
- `src/fronted/features/chat/LearningPage.tsx`：接入 ContextPack 与学习者记忆，而不是独立聊天入口。

### 11.2 需要新增的边界

- `LearnerModel` 领域对象与 repository。
- `EncounterRecorder` 事件写入。
- `AnnotationProjector` 纯函数投影。
- `RecommendationEngine` 纯函数评分 + 可解释理由。
- `ReviewScheduler` FSRS。
- `ContextIndex` 向量检索。
- `AiLearningGateway` 统一模型路由、schema、缓存、降级。

### 11.3 明确不做

- 不把 AI 聊天框做成主界面。
- 不在实时字幕渲染路径调用 LLM。
- 不让默认词表继续伪装成个人生词。
- 不在没有数据时上深度知识追踪。
- 不用弹窗/答题阻断视频播放。
- 不为了「AI native」而给每个功能都加生成式文案。

## 12. 完成定义

当以下条件同时成立，可以认为这套重构真正落地：

- 用户能在一句话里说清每个标记的含义。
- 每个词都有来源、状态、上下文和可撤销的历史。
- 主字幕只表达学习状态，推荐不再污染正文。
- 复习由遗忘曲线驱动，而不是由页面入口驱动。
- AI 只在有价值的时刻出现，并且能解释、能关闭、能降级。
- 断网时核心观看与本地学习闭环仍然可用。
- 团队能通过留存、复习和推荐指标判断下一步，而不是靠感觉。

这套方案的核心不是「加入更多 AI」，而是让 AI 有一个值得依赖的学习记忆底座。底座完成后，词卡、摘要、跟读、角色扮演、内容推荐都会变成同一套学习模型的不同出口。

## 13. 实施记录

### R0：真实与可控（已完成首版）

已落地：

- `dp_words` 增加 `status / source / mastery / confidence / last_seen_at / mastered_at`。
- 新增 `dp_word_encounter` 事件表，记录 `open / save / known / ignore` 等真实交互。
- 新增 drizzle 迁移 `0015_blue_lake.sql` 与自定义迁移 `default-vocabulary-source-v1`。
- 历史默认词表标记为 `source=default, status=ignored`；新安装的 starter pack 也不再进入正文标注。
- 字幕匹配只向渲染进程返回 `learning / familiar` 的活跃词，并携带 `wordStates`。
- 前端新增状态投影：`learning` 使用学习下划线，`familiar` 在教练模式下使用点状弱提示，`known / ignored` 不标记。
- 词卡新增「已掌握 / 忽略」动作与当前状态说明；再次点击可回到 learning。
- 播放器设置新增「词汇提示：关闭 / 安静 / 教练」。
- 词汇工坊列表显示非 learning 状态徽章。

验证：

- `pnpm run typecheck` 通过。
- 相关 ESLint 零告警。
- 单测 745 passed / 9 skipped。
- Playwright `@smoke` 5 passed，覆盖真实启动、引导、播放核心链路与设置页。
- 新增状态投影、词表过滤、遭遇事件、默认词迁移和收藏重新激活测试。

### R1：学习记忆（已完成核心闭环）

已落地：

- 新增 `dp_review_card` 与迁移 `0016_fancy_baron_zemo.sql`，按 lemma 保存到期时间、阶段、稳定度、难度、复习次数与遗忘次数。
- 新增透明掌握度纯函数 `applyMasteryEvidence`：打开/收藏只积累证据，跟读/听写与复习评分才改变掌握判断，用户手动「已掌握 / 忽略」拥有最高优先级。
- 新增 FSRS-lite 调度器 `scheduleReview`，不引入新依赖；支持 Again / Hard / Good / Easy 四档与练习分数映射。
- `WordEncounterService` 将 `save / shadow / dictation / review / known / ignore` 接入掌握度与复习卡；到期的复习卡只来自 `learning / familiar` 且排除默认词表。
- 跟读/听写按逐词对齐结果写入 `score` 证据，普通字幕词不会因此被加入个人词表。
- 播放器主字幕学习台新增复习坞：先回忆、再揭示，四档反馈后立即换下一张；工具条显示到期数量，练习完成后自动刷新。
- 7 天 / 30 天回忆指标按 `Good + Easy` 占比统计；手动标记已掌握/忽略与删除词条会清理对应复习卡。
- 播放器学习台新增「本次学习」摘要：按当前视频 + 字幕哈希保存稳定的会话锚点，统计本次遇见、已掌握、到期与跟读/听写次数，并展示最近遇见词与状态；弹层开关不重置会话。
- 复习评分会携带当前播放上下文写入事件流，播放器内完成的复习同样计入本次学习。
- 设置页新增学习数据治理：导出用户词表、全部遭遇事件、复习卡与 7/30 天指标为 JSON；清除学习记录只删除事件、复习卡与掌握字段，保留词表、释义和学习状态。
- 新增学习数据服务与仓储测试，使用真实内存 SQLite，覆盖会话过滤、摘要计数、导出、JSON 写入与清除边界。

验证：

- `pnpm run typecheck` 通过。
- `pnpm run lint` 零告警。
- 单测 780 passed / 9 skipped。
- Playwright `@smoke` 5 passed。

R0 结束时曾待完成、现已由 R1 首版承接：

- `p_know` 的完整证据更新与不确定性模型。
- FSRS 复习卡、到期队列、复习坞。
- 跟读/听写结果接入掌握度。
- 7 天 / 30 天回忆指标。
- 会话摘要与学习数据导出/重置。
