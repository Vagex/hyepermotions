const state = {
  topic:
    '以“未来城市”为主题，展示科技与人文共融的城市生活，画面要有电影感，包含无人驾驶交通、绿色建筑、智能交互与温暖的人文场景，整体风格希望未来感、温度感兼具。',
  relayUrl: 'http://127.0.0.1:4446/relay/v1/chat/completions',
  projectTitle: '未来城市宣传片',
  duration: 60,
  style: '电影级',
  audience: '大众观众',
  ratio: '16:9',
  generationCount: 0,
  scenes: [],
  storyboard: [],
  outline: [],
  brief: '',
  payload: null,
  hyperframes: null,
  workflowStage: 'input',
  workflowHeadline: '等待输入需求',
  workflowMessage: '输入主题后，系统会先提炼 brief，再生成分镜草案，最后整理成 HyperFrames 前置结构。',
  generationSource: 'local',
  generationError: '',
  isGenerating: false,
};

const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:4173' : '';

const el = {
  topicInput: document.getElementById('topicInput'),
  charCount: document.getElementById('charCount'),
  durationSelect: document.getElementById('durationSelect'),
  styleSelect: document.getElementById('styleSelect'),
  audienceSelect: document.getElementById('audienceSelect'),
  ratioSelect: document.getElementById('ratioSelect'),
  briefText: document.getElementById('briefText'),
  outlineList: document.getElementById('outlineList'),
  sceneList: document.getElementById('sceneList'),
  payloadText: document.getElementById('payloadText'),
  hyperframesText: document.getElementById('hyperframesText'),
  previewHeadline: document.getElementById('previewHeadline'),
  previewSubtitle: document.getElementById('previewSubtitle'),
  previewTag: document.getElementById('previewTag'),
  previewTime: document.getElementById('previewTime'),
  sceneCountLabel: document.getElementById('sceneCountLabel'),
  projectTitle: document.getElementById('projectTitle'),
  relayUrlLabel: document.getElementById('relayUrlLabel'),
  workflowHeadline: document.getElementById('workflowHeadline'),
  workflowStepPill: document.getElementById('workflowStepPill'),
  workflowMessage: document.getElementById('workflowMessage'),
  workflowMini: document.getElementById('workflowMini'),
  workflowSummaryText: document.getElementById('workflowSummaryText'),
  workflowTrack: document.getElementById('workflowTrack'),
  historyList: document.getElementById('historyList'),
  saveState: document.getElementById('saveState'),
  autoSaveState: document.getElementById('autoSaveState'),
  quotaLabel: document.getElementById('quotaLabel'),
  quotaFill: document.getElementById('quotaFill'),
};

const workflowLabels = {
  input: {
    pill: '输入需求',
    headline: '等待输入需求',
    mini: '输入需求',
    message: '输入主题后，系统会先提炼 brief，再生成分镜草案，最后整理成 HyperFrames 前置结构。',
  },
  brief: {
    pill: '需求提炼',
    headline: '正在提炼需求',
    mini: '需求提炼',
    message: '系统正在把主题压缩成 brief、目标受众、风格和表达重点，确保后续分镜可执行。',
  },
  storyboard: {
    pill: '生成分镜',
    headline: '已生成分镜草案',
    mini: '生成分镜',
    message: '当前内容已经拆成分镜卡片，用户可以直接看到每一镜的画面、旁白与节奏。',
  },
  hyperframes: {
    pill: 'HyperFrames 前置',
    headline: '正在整理 HyperFrames 前置结构',
    mini: 'HyperFrames',
    message: '分镜已经整理成可交给 HyperFrames 的结构化数据，下一步可以直接进入渲染层。',
  },
};

const templates = [
  {
    title: '未来城市宣传片',
    subtitle: '今天 14:32',
    thumb: '00',
    topic:
      '以“未来城市”为主题，展示科技与人文共融的城市生活，画面要有电影感，包含无人驾驶交通、绿色建筑、智能交互与温暖的人文场景，整体风格希望未来感、温度感兼具。',
  },
  {
    title: '产品发布预告',
    subtitle: '昨天 10:15',
    thumb: '01',
    topic:
      '为一款智能办公设备生成 45 秒发布预告，强调效率、便携、极简、质感与创新体验。',
  },
  {
    title: '品牌故事短片',
    subtitle: '05-21 18:40',
    thumb: '02',
    topic:
      '围绕一家坚持可持续设计的品牌，讲述从材料、工艺到用户生活方式的故事，风格克制、温暖、真实。',
  },
  {
    title: '教育课程介绍',
    subtitle: '05-20 09:22',
    thumb: '03',
    topic:
      '生成一条教育课程介绍视频，主题是 AI 时代的高效学习方法，受众为学生和职场新人，风格清晰、可信、节奏明快。',
  },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pick(items, index) {
  return items[index % items.length];
}

function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function inferComplexity(topic) {
  const len = topic.length;
  const keywordCount = [
    '并且',
    '同时',
    '但是',
    '如果',
    '用于',
    '品牌',
    '课程',
    '产品',
    '宣传',
    '发布',
    '复杂',
    '专业',
    '未来',
    '系统',
  ].reduce((count, keyword) => count + (topic.includes(keyword) ? 1 : 0), 0);
  if (len > 120 || keywordCount >= 4) return '复杂';
  if (len > 60 || keywordCount >= 2) return '中等';
  return '简单';
}

function inferStyle(topic, fallback) {
  if (/科技|未来|AI|智能|系统/i.test(topic)) return '科技感';
  if (/品牌|广告|发布|营销/i.test(topic)) return '品牌广告';
  if (/知识|课程|教学|学习|教程/i.test(topic)) return '知识科普';
  if (/纪实|真实|人物|故事/i.test(topic)) return '纪实感';
  return fallback;
}

function inferAudience(topic, fallback) {
  if (/创业|老板|商业|企业|品牌/i.test(topic)) return '创业者';
  if (/职场|办公|效率|工作/i.test(topic)) return '职场人';
  if (/学生|学习|课程|教育/i.test(topic)) return '学生';
  if (/客户|消费者|用户|购买/i.test(topic)) return '品牌客户';
  return fallback;
}

function inferTone(topic) {
  if (/未来|城市|科技|智能/i.test(topic)) return '宏大而克制';
  if (/品牌|发布|营销/i.test(topic)) return '高级而有冲击力';
  if (/教育|学习|知识/i.test(topic)) return '清晰而可信';
  return '清晰而温暖';
}

function inferVisualMotif(topic) {
  if (/未来|城市|科技|智能/i.test(topic)) return '霓虹线条、城市天际线、信息浮层';
  if (/品牌|发布|营销/i.test(topic)) return '高对比产品镜头、材质特写、流体光影';
  if (/教育|学习|知识/i.test(topic)) return '干净信息卡、节奏化字幕、图形图表';
  return '电影感镜头、环境光、细节特写';
}

function buildBrief(topic, meta) {
  return `本片围绕「${topic.replace(/[。！？]/g, '').slice(0, 42)}」展开，目标受众为${meta.audience}，建议采用${meta.duration} 秒的${meta.style}表达，核心情绪是${meta.tone}。视频重点强调${meta.motif}，通过 3 到 5 个连续场景建立“问题 - 解决 - 结果”的观看路径。`;
}

function buildOutline(topic, meta) {
  const base = [
    `开场 5 秒：用一个强钩子建立主题，直接抛出「${topic.slice(0, 12)}」的核心画面。`,
    `中段展开：拆解 2 到 3 个关键概念，结合${meta.motif}说明价值和场景。`,
    `结果收束：给出明确结论、行动建议或品牌记忆点，强化观看后的印象。`,
  ];
  if (meta.complexity !== '简单') {
    base.splice(
      1,
      0,
      `补充过渡：用一句旁白解释主题背景和用户痛点，帮助复杂信息顺滑进入。`,
    );
  }
  return base;
}

function buildScenes(topic, meta) {
  const count = meta.duration <= 30 ? 3 : meta.duration <= 60 ? 4 : 5;
  const sceneDuration = Math.floor(meta.duration / count);
  const hash = hashText(topic + meta.style + meta.audience);
  const variants = [
    {
      title: '开场钩子',
      visual: '一个能够立刻抓住注意力的画面',
      voice: '先给出主题冲击，再引导观众进入内容。',
    },
    {
      title: '核心展开',
      visual: '结构化信息或关键概念的可视化表达',
      voice: '把复杂内容拆成容易理解的段落。',
    },
    {
      title: '场景证明',
      visual: '真实感画面、案例或产品应用环境',
      voice: '让观众看到它如何发生、如何被使用。',
    },
    {
      title: '收束升华',
      visual: '更安静、更有余韵的结尾镜头',
      voice: '用一句总结把信息、情绪和行动统一起来。',
    },
    {
      title: '行动召唤',
      visual: '品牌口号、按钮感文案或下一步建议',
      voice: '给出下一步动作，让视频有明确出口。',
    },
  ];

  return Array.from({ length: count }, (_, index) => {
    const item = pick(variants, hash + index);
    const start = String(index * sceneDuration).padStart(2, '0');
    const end = String((index + 1) * sceneDuration).padStart(2, '0');
    const startSec = index * sceneDuration;
    const endSec = Math.min(meta.duration, (index + 1) * sceneDuration);
    const titleSeed = inferSceneTitle(topic, index, meta, item.title);
    return {
      index: index + 1,
      title: titleSeed,
      duration: `${startSec.toString().padStart(2, '0')}s - ${endSec
        .toString()
        .padStart(2, '0')}s`,
      voiceover: buildVoiceover(topic, meta, index, item.voice),
      visual: buildVisualDescription(topic, meta, index, item.visual),
      badge: `${String(index + 1).padStart(2, '0')}`,
      timingLabel: `${start} - ${end}`,
    };
  });
}

function inferSceneTitle(topic, index, meta, fallback) {
  const keywords = {
    0: /未来|科技|智能|城市|产品|品牌|课程/.test(topic) ? '开场建立主题' : fallback,
    1: /未来|科技|智能|城市/.test(topic)
      ? '智能生活方式'
      : /品牌|产品/.test(topic)
        ? '产品核心价值'
        : /课程|学习|知识/.test(topic)
          ? '知识拆解'
          : '核心展开',
    2: /未来|科技|智能|城市/.test(topic)
      ? '人与系统协同'
      : /品牌|产品/.test(topic)
        ? '真实应用场景'
        : /课程|学习|知识/.test(topic)
          ? '学习路径示例'
          : '场景证明',
    3: /未来|科技|智能|城市/.test(topic)
      ? '温度与秩序'
      : /品牌|产品/.test(topic)
        ? '品牌印象收束'
        : /课程|学习|知识/.test(topic)
          ? '总结与转化'
          : '收束升华',
    4: /未来|科技|智能|城市/.test(topic)
      ? '希望的未来'
      : /品牌|产品/.test(topic)
        ? '行动召唤'
        : /课程|学习|知识/.test(topic)
          ? '下一步行动'
          : '行动召唤',
  };
  return keywords[index] || fallback;
}

function buildVoiceover(topic, meta, index, fallback) {
  const sentenceBank = [
    `从这个问题出发，我们先看清主题的真实需求。`,
    `把信息拆开后，你会发现重点其实非常明确。`,
    `当画面和旁白同步时，复杂主题也会变得很好理解。`,
    `最后，我们把核心价值稳定地落到观众心里。`,
    `如果需要行动，就在结尾给出一句足够清晰的提示。`,
  ];
  const topicLead = topic.replace(/[。！？]/g, '').slice(0, 22);
  return `${topicLead}。${sentenceBank[index] || fallback}`;
}

function buildVisualDescription(topic, meta, index, fallback) {
  if (index === 0) {
    return `${meta.motif}，建立第一眼的主题冲击。`;
  }
  if (/未来|科技|智能|城市/.test(topic)) {
    const scenes = [
      '无人驾驶交通穿行在城市主轴，航拍镜头推进。',
      '绿色建筑立面与人流、信息流同屏出现。',
      '智能交互界面浮现于生活空间中，强调协同体验。',
      '孩子、通勤者与夜景共同构成温暖的收束画面。',
    ];
    return scenes[index] || fallback;
  }
  if (/品牌|产品/.test(topic)) {
    const scenes = [
      '产品在极简布光下完成强势亮相。',
      '材质、工艺和功能点被逐一放大。',
      '用户在真实环境中使用，形成可信证据。',
      '品牌主张与下一步行动被统一到结尾。',
    ];
    return scenes[index] || fallback;
  }
  if (/教育|学习|知识/.test(topic)) {
    const scenes = [
      '知识结构用卡片和图形分层展示。',
      '关键方法拆成可执行步骤。',
      '案例与应用场景并行，增强理解。',
      '总结页给出明确行动路径。 ',
    ];
    return scenes[index] || fallback;
  }
  return `${fallback}，让信息具象化。`;
}

function buildPayload(topic, meta, scenes) {
  return {
    model: 'gpt-4.1-mini',
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content:
          '你是视频策划助手，先输出结构化 brief、outline、scene plan，再交由 HyperFrames 生成视频工程。',
      },
      {
        role: 'user',
        content: topic,
      },
    ],
    metadata: {
      platform: 'web',
      audience: meta.audience,
      style: meta.style,
      duration: meta.duration,
      ratio: meta.ratio,
      sceneCount: scenes.length,
    },
  };
}

function buildHyperframesConfig(meta, scenes, projectTitle) {
  return {
    compositionId: 'main-video',
    width: meta.ratio === '9:16' ? 1080 : meta.ratio === '1:1' ? 1080 : 1920,
    height: meta.ratio === '9:16' ? 1920 : 1080,
    duration: meta.duration,
    title: projectTitle,
    style: meta.style,
    timeline: scenes.map((scene) => ({
      id: `scene-${scene.index}`,
      start: `${scene.timingLabel.split(' - ')[0]}`,
      duration: scene.duration,
      trackIndex: scene.index,
      caption: scene.voiceover,
    })),
  };
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function renderHistory(activeTopic) {
  const tpl = document.getElementById('historyItemTpl');
  el.historyList.innerHTML = '';
  templates.forEach((item, index) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.history-thumb').textContent = item.thumb;
    node.querySelector('strong').textContent = item.title;
    node.querySelector('span').textContent = item.subtitle;
    if (index === 0) node.classList.add('active');
    node.addEventListener('click', () => {
      state.topic = item.topic;
      el.topicInput.value = item.topic;
      syncForm();
      generate();
    });
    el.historyList.appendChild(node);
  });
}

function updateMetaInfo() {
  el.charCount.textContent = `${state.topic.length}/1000`;
  el.projectTitle.textContent = state.projectTitle;
  el.relayUrlLabel.textContent = state.relayUrl;
  el.saveState.textContent = state.generationCount ? '已保存' : '未保存';
  el.autoSaveState.textContent = `已自动保存 ${new Date(2026, 4, 12, 14, 32).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`;
  el.quotaLabel.textContent = '12h 30m';
  el.quotaFill.style.width = '68%';
}

function renderScenarios() {
  el.briefText.textContent = state.brief;
  el.outlineList.innerHTML = '';
  state.outline.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    el.outlineList.appendChild(li);
  });

  el.sceneList.innerHTML = '';
  state.scenes.forEach((scene) => {
    const item = document.createElement('article');
    item.className = 'scene-item';
    item.innerHTML = `
      <div class="scene-thumb">
        <div class="scene-badge">${scene.badge}</div>
      </div>
      <div class="scene-body">
        <h4>${scene.title}</h4>
        <div class="meta">${scene.duration}</div>
        <p><strong>旁白：</strong>${scene.voiceover}</p>
        <p><strong>画面：</strong>${scene.visual}</p>
      </div>
    `;
    el.sceneList.appendChild(item);
  });
  el.sceneCountLabel.textContent = `(${state.scenes.length})`;
  el.previewHeadline.textContent = state.scenes[0]?.title || '在科技与人文的共融中，未来城市正向我们走来';
  el.previewSubtitle.textContent = state.scenes[0]?.voiceover || '科技向前，生活向暖。';
  el.previewTag.textContent = `${state.style} · ${state.audience} · ${state.ratio}`;
  el.previewTime.textContent = state.duration <= 30 ? '00:03 / 00:30' : state.duration <= 60 ? '00:04 / 01:00' : '00:06 / 01:30';
  el.payloadText.textContent = formatJson(state.payload);
  el.hyperframesText.textContent = formatJson(state.hyperframes);
  updateWorkflowUI();
}

function syncForm() {
  el.topicInput.value = state.topic;
  el.durationSelect.value = String(state.duration);
  el.styleSelect.value = state.style;
  el.audienceSelect.value = state.audience;
  el.ratioSelect.value = state.ratio;
  updateMetaInfo();
}

function buildLocalPlan(topic, meta) {
  const projectTitle = generateTitleFromTopic(topic);
  const scenes = buildScenes(topic, meta);
  return {
    projectTitle,
    brief: buildBrief(topic, meta),
    outline: buildOutline(topic, meta),
    scenes,
    storyboard: scenes,
    payload: buildPayload(topic, meta, scenes),
    hyperframes: buildHyperframesConfig(meta, scenes, projectTitle),
  };
}

function applyPlan(plan, meta, source, errorMessage) {
  state.projectTitle = plan.projectTitle;
  state.brief = plan.brief;
  state.outline = plan.outline;
  state.scenes = plan.scenes;
  state.storyboard = plan.storyboard || plan.scenes || [];
  state.payload = plan.payload;
  state.hyperframes = plan.hyperframes;
  state.generationSource = source || 'local';
  state.generationError = errorMessage || '';
  state.generationCount += 1;
  state.style = meta.style;
  state.audience = meta.audience;
  state.ratio = meta.ratio;
  state.duration = meta.duration;
  el.styleSelect.value = state.style;
  el.audienceSelect.value = state.audience;
  el.ratioSelect.value = state.ratio;
}

function updateWorkflowUI() {
  const config = workflowLabels[state.workflowStage] || workflowLabels.input;
  const stageOrder = ['input', 'brief', 'storyboard', 'hyperframes'];
  const activeIndex = stageOrder.indexOf(state.workflowStage);

  el.workflowHeadline.textContent = config.headline;
  el.workflowStepPill.textContent = config.pill;
  el.workflowMessage.textContent = config.message;
  el.workflowMini.textContent = config.mini;

  const sceneCount = state.scenes.length;
  const sourceLabel =
    state.generationSource === 'relay'
      ? 'cc-relay 已回填'
      : state.generationSource === 'local_fallback'
        ? '本地草案兜底'
        : state.generationSource === 'local_preview'
          ? '本地预览'
          : '等待生成';
  const storyboardLabel = sceneCount ? `已生成 ${sceneCount} 个分镜卡片` : '尚未拆出分镜卡片';
  el.workflowSummaryText.textContent = `${config.headline}。${storyboardLabel}。${sourceLabel}。`;

  document.querySelectorAll('.workflow-step').forEach((node) => {
    const stage = node.getAttribute('data-stage');
    const index = stageOrder.indexOf(stage);
    node.classList.toggle('is-active', stage === state.workflowStage);
    node.classList.toggle('is-complete', index > -1 && index < activeIndex);
  });
}

function setWorkflowStage(stage, detail = {}) {
  state.workflowStage = stage;
  const config = workflowLabels[stage] || workflowLabels.input;
  state.workflowHeadline = detail.headline || config.headline;
  state.workflowMessage = detail.message || config.message;
  updateWorkflowUI();
}

function setGenerationBusy(isBusy, text) {
  state.isGenerating = isBusy;
  el.saveState.textContent = text || (isBusy ? '生成中' : '已保存');
  document.getElementById('generateBtn').disabled = isBusy;
  document.getElementById('generateTopBtn').disabled = isBusy;
  document.getElementById('optimizeBtn').disabled = isBusy;
}

function buildGenerationRequest(topic, meta) {
  return {
    topic,
    duration: meta.duration,
    style: meta.style,
    audience: meta.audience,
    ratio: meta.ratio,
    relayUrl: state.relayUrl,
  };
}

async function requestRemotePlan(requestBody) {
  const response = await fetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed with ${response.status}`);
  }
  return data;
}

async function generate() {
  const topic = (el.topicInput.value || '').trim();
  state.topic = topic || '请输入一个视频主题';
  state.duration = Number(el.durationSelect.value);
  state.style = inferStyle(state.topic, el.styleSelect.value);
  state.audience = inferAudience(state.topic, el.audienceSelect.value);
  state.ratio = el.ratioSelect.value;
  const meta = {
    complexity: inferComplexity(state.topic),
    tone: inferTone(state.topic),
    motif: inferVisualMotif(state.topic),
    audience: state.audience,
    duration: state.duration,
    style: state.style,
    ratio: state.ratio,
  };

  setWorkflowStage('brief', {
    headline: '正在提炼需求',
    message: '先从主题中抽出目标、受众、风格和节奏，随后再进入分镜生成。',
  });
  const localPlan = buildLocalPlan(state.topic, meta);
  setGenerationBusy(true, '生成中');
  el.relayUrlLabel.textContent = state.relayUrl;
  applyPlan(localPlan, meta, 'local_preview', '');
  setWorkflowStage('storyboard', {
    headline: '已生成分镜草案',
    message: `当前已经拆出 ${state.scenes.length} 个分镜卡片，接下来会对接 cc-relay 做结构校验。`,
  });
  updateMetaInfo();
  renderScenarios();
  setGenerationBusy(false, '已保存');
  flashSaveState('本地预览');

  setWorkflowStage('hyperframes', {
    headline: '正在准备 HyperFrames 前置结构',
    message: '分镜草案已经整理成可交给 HyperFrames 的 timeline 数据。',
  });
  requestRemotePlan(buildGenerationRequest(state.topic, meta))
    .then((remote) => {
      const plan = remote?.plan || localPlan;
      applyPlan(plan, meta, remote?.source || 'local', remote?.error || '');
      el.relayUrlLabel.textContent = remote?.relay?.url || state.relayUrl;
      setWorkflowStage(remote?.source === 'relay' ? 'hyperframes' : 'storyboard', {
        headline: remote?.source === 'relay' ? 'HyperFrames 前置已准备好' : '分镜草案已完成',
        message:
          remote?.source === 'relay'
            ? 'cc-relay 已回填最终分镜和结构化数据，可以直接进入 HyperFrames 生成层。'
            : '本地分镜草案已完成，等待 relay 回填时也可以继续查看与编辑。',
      });
      updateMetaInfo();
      renderScenarios();
      flashSaveState(remote?.source === 'relay' ? '已连接 cc-relay' : '本地回退');
    })
    .catch((error) => {
      applyPlan(localPlan, meta, 'local_fallback', error instanceof Error ? error.message : String(error));
      setWorkflowStage('storyboard', {
        headline: '分镜草案已生成',
        message: 'cc-relay 暂时不可用，当前展示的是本地生成的分镜草案。',
      });
      updateMetaInfo();
      renderScenarios();
      flashSaveState('本地回退');
    });
}

function flashSaveState(text) {
  el.saveState.textContent = text || (state.generationSource === 'relay' ? '已保存 · cc-relay' : '已保存');
  el.saveState.classList.add('btn-success');
  window.setTimeout(() => {
    el.saveState.classList.remove('btn-success');
  }, 700);
}

function copyText(text) {
  return navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

function attachEvents() {
  el.topicInput.addEventListener('input', () => {
    state.topic = el.topicInput.value;
    el.charCount.textContent = `${state.topic.length}/1000`;
  });

  el.durationSelect.addEventListener('change', () => {
    state.duration = Number(el.durationSelect.value);
  });

  el.styleSelect.addEventListener('change', () => {
    state.style = el.styleSelect.value;
  });

  el.audienceSelect.addEventListener('change', () => {
    state.audience = el.audienceSelect.value;
  });

  el.ratioSelect.addEventListener('change', () => {
    state.ratio = el.ratioSelect.value;
  });

  document.getElementById('generateBtn').addEventListener('click', generate);
  document.getElementById('generateTopBtn').addEventListener('click', generate);
  document.getElementById('optimizeBtn').addEventListener('click', () => {
    const topic = el.topicInput.value.trim();
    if (!topic) return;
    el.topicInput.value = improveTopic(topic);
    state.topic = el.topicInput.value;
    el.charCount.textContent = `${state.topic.length}/1000`;
    generate();
  });

  document.getElementById('newProjectBtn').addEventListener('click', () => {
    el.topicInput.value =
      '请生成一条 60 秒的视频，讲述一个 AI 驱动的在线视频自动生成平台如何帮助用户把主题快速转成提纲、分镜与成片。';
    state.topic = el.topicInput.value;
    generate();
  });

  document.getElementById('renameBtn').addEventListener('click', () => {
    const next = prompt('请输入新的项目名称', state.projectTitle);
    if (!next) return;
    state.projectTitle = next.trim();
    updateMetaInfo();
    renderScenarios();
  });

  document.getElementById('editRelayBtn').addEventListener('click', () => {
    const next = prompt('请输入 cc-relay 中转 API 地址', state.relayUrl);
    if (!next) return;
    state.relayUrl = next.trim();
    updateMetaInfo();
  });

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const blob = new Blob([formatJson(state.hyperframes)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.projectTitle || 'video-project'}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  document.getElementById('addSceneBtn').addEventListener('click', () => {
    const extraScene = {
      index: state.scenes.length + 1,
      title: '补充镜头',
      duration: '自动追加',
      voiceover: '为内容增加一个过渡镜头，增强节奏感。',
      visual: '补足叙事节奏，让结构更完整。',
      badge: String(state.scenes.length + 1).padStart(2, '0'),
      timingLabel: 'auto',
    };
    state.scenes = [...state.scenes, extraScene];
    state.payload = buildPayload(state.topic, {
      audience: state.audience,
      duration: state.duration,
      style: state.style,
      ratio: state.ratio,
    }, state.scenes);
    state.hyperframes = buildHyperframesConfig(
      { duration: state.duration, style: state.style, ratio: state.ratio },
      state.scenes,
      state.projectTitle,
    );
    renderScenarios();
    flashSaveState();
  });

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = button.getAttribute('data-copy');
      const text =
        target === 'brief'
          ? state.brief
          : target === 'outline'
            ? state.outline.join('\n')
            : target === 'payload'
              ? formatJson(state.payload)
              : formatJson(state.hyperframes);
      await copyText(text);
      button.textContent = '已复制';
      window.setTimeout(() => {
        button.textContent = target === 'payload' ? '复制 JSON' : '复制';
      }, 900);
    });
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const label = chip.textContent?.trim();
      if (label === '生成标题') {
        const headline = generateTitleFromTopic(el.topicInput.value);
        state.projectTitle = headline;
        updateMetaInfo();
      } else if (label === '拆分分镜') {
        generate();
      } else if (label === '补充旁白') {
        state.scenes = state.scenes.map((scene, index) => ({
          ...scene,
          voiceover: scene.voiceover + (index === state.scenes.length - 1 ? ' 结尾留出一个轻微的停顿。' : ''),
        }));
        renderScenarios();
      } else {
        el.topicInput.value = improveTopic(el.topicInput.value.trim());
        state.topic = el.topicInput.value;
        el.charCount.textContent = `${state.topic.length}/1000`;
        generate();
      }
    });
  });
}

function generateTitleFromTopic(topic) {
  const text = topic.replace(/[。！？]/g, '').trim();
  if (/未来|城市/.test(text)) return '未来城市影像方案';
  if (/品牌|产品/.test(text)) return '品牌发布短片';
  if (/学习|教育|课程/.test(text)) return '知识讲解视频';
  if (text.length <= 10) return `${text}视频方案`;
  return `${text.slice(0, 10)}…方案`;
}

function improveTopic(topic) {
  const cleaned = topic.replace(/\s+/g, ' ').trim();
  if (!cleaned) return cleaned;
  if (/以“.*?”为主题/.test(cleaned)) return cleaned;
  if (/未来|科技|城市/.test(cleaned)) {
    return `以“未来城市”为主题，展示科技与人文共融的城市生活，画面要有电影感，包含无人驾驶交通、绿色建筑、智能交互与温暖的人文场景，整体风格希望未来感、温度感兼具。`;
  }
  if (/产品|品牌|发布/.test(cleaned)) {
    return `围绕该主题生成一条品牌视频，强调产品价值、使用场景与品牌气质，风格高级、简洁、具有记忆点。`;
  }
  if (/学习|教育|课程/.test(cleaned)) {
    return `围绕该主题制作知识科普短片，要求结构清晰、节奏明快、旁白易懂，并适合短视频平台传播。`;
  }
  return `${cleaned}，请补充目标受众、画面风格、视频时长与想要传达的核心信息。`;
}

function bootstrap() {
  renderHistory(state.topic);
  syncForm();
  attachEvents();
  updateWorkflowUI();
  generate();
}

bootstrap();
