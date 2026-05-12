const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DEFAULT_RELAY_URL = process.env.CC_RELAY_URL || 'http://127.0.0.1:4446/relay/v1/chat/completions';
const DEFAULT_MODEL = process.env.CC_RELAY_MODEL || 'gpt-4.1-mini';
const DEFAULT_API_KEY = process.env.CC_RELAY_API_KEY || '';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data, null, 2), {
    'Content-Type': 'application/json; charset=utf-8',
  });
}

function cleanJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(candidate.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractRelayText(rawText) {
  if (!rawText) return '';
  let output = '';
  for (const block of rawText.split(/\n\s*\n/)) {
    const dataLines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) continue;
    const rawData = dataLines.join('\n');
    if (!rawData || rawData === '[DONE]') continue;

    try {
      const payload = JSON.parse(rawData);
      if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
        output += payload.delta;
      } else if (
        payload.type === 'response.output_item.done' &&
        payload.item &&
        payload.item.type === 'message' &&
        Array.isArray(payload.item.content)
      ) {
        const text = payload.item.content
          .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
          .join('');
        if (text) output = text;
      } else if (
        payload.type === 'response.completed' &&
        payload.response &&
        Array.isArray(payload.response.output)
      ) {
        const message = payload.response.output.find((item) => item && item.type === 'message');
        if (message && Array.isArray(message.content)) {
          const text = message.content
            .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
            .join('');
          if (text) output = text;
        }
      }
    } catch {
      continue;
    }
  }
  return output.trim();
}

function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(items, index) {
  return items[index % items.length];
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

function generateTitleFromTopic(topic) {
  const text = topic.replace(/[。！？]/g, '').trim();
  if (/未来|城市/.test(text)) return '未来城市影像方案';
  if (/品牌|产品/.test(text)) return '品牌发布短片';
  if (/学习|教育|课程/.test(text)) return '知识讲解视频';
  if (text.length <= 10) return `${text}视频方案`;
  return `${text.slice(0, 10)}…方案`;
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
    base.splice(1, 0, '补充过渡：用一句旁白解释主题背景和用户痛点，帮助复杂信息顺滑进入。');
  }
  return base;
}

function buildVoiceover(topic, index, fallback) {
  const sentenceBank = [
    '从这个问题出发，我们先看清主题的真实需求。',
    '把信息拆开后，你会发现重点其实非常明确。',
    '当画面和旁白同步时，复杂主题也会变得很好理解。',
    '最后，我们把核心价值稳定地落到观众心里。',
    '如果需要行动，就在结尾给出一句足够清晰的提示。',
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
      '总结页给出明确行动路径。',
    ];
    return scenes[index] || fallback;
  }
  return `${fallback}，让信息具象化。`;
}

function buildScenes(topic, meta) {
  const count = meta.duration <= 30 ? 3 : meta.duration <= 60 ? 4 : 5;
  const sceneDuration = Math.floor(meta.duration / count);
  const hash = hashText(topic + meta.style + meta.audience);
  const variants = [
    { title: '开场钩子', visual: '一个能够立刻抓住注意力的画面', voice: '先给出主题冲击，再引导观众进入内容。' },
    { title: '核心展开', visual: '结构化信息或关键概念的可视化表达', voice: '把复杂内容拆成容易理解的段落。' },
    { title: '场景证明', visual: '真实感画面、案例或产品应用环境', voice: '让观众看到它如何发生、如何被使用。' },
    { title: '收束升华', visual: '更安静、更有余韵的结尾镜头', voice: '用一句总结把信息、情绪和行动统一起来。' },
    { title: '行动召唤', visual: '品牌口号、按钮感文案或下一步建议', voice: '给出下一步动作，让视频有明确出口。' },
  ];

  return Array.from({ length: count }, (_, index) => {
    const item = pick(variants, hash + index);
    const startSec = index * sceneDuration;
    const endSec = Math.min(meta.duration, (index + 1) * sceneDuration);
    return {
      index: index + 1,
      title: inferSceneTitle(topic, index, item.title),
      duration: `${String(startSec).padStart(2, '0')}s - ${String(endSec).padStart(2, '0')}s`,
      voiceover: buildVoiceover(topic, index, item.voice),
      visual: buildVisualDescription(topic, meta, index, item.visual),
      badge: String(index + 1).padStart(2, '0'),
      timingLabel: `${String(startSec).padStart(2, '0')} - ${String(endSec).padStart(2, '0')}`,
    };
  });
}

function inferSceneTitle(topic, index, fallback) {
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

function buildLocalPlan(input) {
  const topic = input.topic.trim();
  const duration = Number(input.duration);
  const style = inferStyle(topic, input.style);
  const audience = inferAudience(topic, input.audience);
  const ratio = input.ratio;
  const complexity = inferComplexity(topic);
  const tone = inferTone(topic);
  const motif = inferVisualMotif(topic);
  const meta = {
    complexity,
    tone,
    motif,
    audience,
    duration,
    style,
    ratio,
  };
  const projectTitle = generateTitleFromTopic(topic);
  const scenes = buildScenes(topic, meta);
  const payload = {
    model: DEFAULT_MODEL,
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content:
          '你是视频策划助手，先输出结构化 brief、outline、scene plan，再交由 HyperFrames 生成视频工程。',
      },
      { role: 'user', content: topic },
    ],
    metadata: {
      platform: 'web',
      audience,
      style,
      duration,
      ratio,
      sceneCount: scenes.length,
    },
  };

  return {
    projectTitle,
    brief: buildBrief(topic, meta),
    outline: buildOutline(topic, meta),
    scenes,
    storyboard: scenes,
    payload,
    hyperframes: buildHyperframesConfig(meta, scenes, projectTitle),
    hyperframesHtml: buildHyperframesHtml(meta, scenes, projectTitle),
    relay: {
      mode: 'local',
      url: input.relayUrl || DEFAULT_RELAY_URL || '',
      enabled: false,
    },
    meta,
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
      start: scene.timingLabel.split(' - ')[0],
      duration: scene.duration,
      trackIndex: scene.index,
      caption: scene.voiceover,
    })),
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseSceneRange(scene, index, duration) {
  const numbers = String(scene.timingLabel || scene.duration || '').match(/\d+/g);
  if (numbers && numbers.length >= 2) {
    return {
      start: Number(numbers[0]),
      end: Number(numbers[1]),
    };
  }
  const count = Math.max(1, index + 1);
  const sceneDuration = Math.max(1, Math.floor(duration / count));
  return {
    start: index * sceneDuration,
    end: Math.min(duration, (index + 1) * sceneDuration),
  };
}

function buildHyperframesHtml(meta, scenes, projectTitle) {
  const width = meta.ratio === '9:16' ? 1080 : meta.ratio === '1:1' ? 1080 : 1920;
  const height = meta.ratio === '9:16' ? 1920 : 1080;
  const palette = meta.style.includes('科技')
    ? {
        bg: '#07111f',
        surface: '#0f1d33',
        accent: '#63e6d4',
        text: '#eef5ff',
        muted: '#96a6c6',
      }
    : {
        bg: '#0b0f16',
        surface: '#151b26',
        accent: '#63e6d4',
        text: '#f3f6fb',
        muted: '#98a5bc',
      };

  const sceneBlocks = scenes
    .map((scene, index) => {
      const range = parseSceneRange(scene, index, meta.duration);
      const title = escapeHtml(scene.title);
      const voiceover = escapeHtml(scene.voiceover);
      const visual = escapeHtml(scene.visual);
      return `
      <article
        class="scene-card"
        id="scene-${index + 1}"
        data-start="${range.start}"
        data-duration="${Math.max(1, range.end - range.start)}"
        data-track-index="${index}"
      >
        <div class="scene-index">${String(index + 1).padStart(2, '0')}</div>
        <div class="scene-copy">
          <p class="scene-label">分镜 ${String(index + 1).padStart(2, '0')}</p>
          <h2>${title}</h2>
          <p class="scene-voice">${voiceover}</p>
          <p class="scene-visual">${visual}</p>
        </div>
      </article>`;
    })
    .join('\n');

  const timelineSteps = scenes
    .map((scene, index) => {
      const range = parseSceneRange(scene, index, meta.duration);
      return `tl.fromTo('#scene-${index + 1}', { opacity: 0, y: 24, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'power2.out' }, ${range.start});`;
    })
    .join('\n      ');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(projectTitle)} - HyperFrames Draft</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: ${palette.bg};
      color: ${palette.text};
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      overflow: hidden;
    }
    [data-composition-id="main-video"] {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background:
        radial-gradient(circle at top left, rgba(99, 230, 212, 0.18), transparent 36%),
        linear-gradient(180deg, ${palette.bg}, #050814 100%);
    }
    .scene-layer {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 64px;
      box-sizing: border-box;
    }
    .hero-copy {
      position: absolute;
      top: 54px;
      left: 64px;
      right: 64px;
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      z-index: 2;
    }
    .hero-copy h1 {
      margin: 0;
      font-size: ${meta.ratio === '9:16' ? 50 : 58}px;
      line-height: 1.02;
      letter-spacing: -0.04em;
      max-width: ${meta.ratio === '9:16' ? 720 : 920}px;
    }
    .hero-copy p {
      margin: 10px 0 0;
      color: ${palette.muted};
      font-size: ${meta.ratio === '9:16' ? 18 : 20}px;
      line-height: 1.55;
      max-width: ${meta.ratio === '9:16' ? 620 : 680}px;
    }
    .hero-chip {
      padding: 12px 16px;
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: ${palette.accent};
      font-size: 14px;
      font-weight: 700;
      white-space: nowrap;
    }
    .scene-stack {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 18px;
      justify-content: flex-end;
      box-sizing: border-box;
      padding-top: 160px;
    }
    .scene-card {
      display: grid;
      grid-template-columns: 72px 1fr;
      gap: 20px;
      align-items: stretch;
      padding: 20px;
      border-radius: 28px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      backdrop-filter: blur(18px);
      box-shadow: 0 22px 50px rgba(0, 0, 0, 0.24);
    }
    .scene-index {
      display: grid;
      place-items: center;
      border-radius: 20px;
      background: rgba(99, 230, 212, 0.14);
      color: ${palette.accent};
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 0.08em;
    }
    .scene-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .scene-label {
      margin: 0;
      color: ${palette.accent};
      font-size: 12px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .scene-copy h2 {
      margin: 0;
      font-size: ${meta.ratio === '9:16' ? 34 : 40}px;
      line-height: 1.08;
      letter-spacing: -0.03em;
    }
    .scene-voice,
    .scene-visual {
      margin: 0;
      color: ${palette.muted};
      font-size: 16px;
      line-height: 1.6;
    }
    .scene-visual {
      color: rgba(255,255,255,0.82);
    }
  </style>
</head>
<body>
  <div data-composition-id="main-video" data-width="${width}" data-height="${height}" data-duration="${meta.duration}" data-start="0">
    <div class="scene-layer">
      <div class="hero-copy">
        <div>
          <h1>${escapeHtml(projectTitle)}</h1>
          <p>${escapeHtml(meta.style)} · ${escapeHtml(meta.audience)} · ${meta.duration}s · 这是一份可直接交给 HyperFrames 的分镜 composition 草案。</p>
        </div>
        <div class="hero-chip">${escapeHtml(meta.motif)}</div>
      </div>
      <div class="scene-stack">
        ${sceneBlocks}
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } });
      ${timelineSteps}
      window.__timelines['main-video'] = tl;
    </script>
  </div>
</body>
</html>`;
}

function resolveRelayUrl(input) {
  const raw = (input.relayUrl || DEFAULT_RELAY_URL || '').trim();
  if (!raw || raw === 'https://relay.example.com/v1/chat/completions') return '';
  try {
    const url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `http://${raw}`);
    const pathname = url.pathname.replace(/\/$/, '');
    if (!pathname) {
      url.pathname = '/relay/v1/chat/completions';
    } else if (pathname === '/relay/v1') {
      url.pathname = '/relay/v1/chat/completions';
    } else if (pathname === '/') {
      url.pathname = '/relay/v1/chat/completions';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

function buildRelayPrompt(input, localPlan) {
  return [
    {
      role: 'system',
      content:
        '你是一个在线视频自动生成策划引擎。请只输出严格 JSON，不要代码块，不要额外解释。JSON 必须包含 projectTitle, brief, outline, scenes, storyboard, hyperframes, hyperframesHtml, meta。',
    },
    {
      role: 'user',
      content: JSON.stringify(
        {
          topic: input.topic,
          duration: input.duration,
          style: input.style,
          audience: input.audience,
          ratio: input.ratio,
          outputSchema: {
            projectTitle: 'string',
            brief: 'string',
            outline: ['string'],
            scenes: [
              {
                index: 'number',
                title: 'string',
                duration: 'string',
                voiceover: 'string',
                visual: 'string',
                badge: 'string',
                timingLabel: 'string',
              },
            ],
            storyboard: 'same as scenes, but may include any cleaned-up editorial ordering',
            hyperframes: {
              compositionId: 'string',
              width: 'number',
              height: 'number',
              duration: 'number',
              title: 'string',
              style: 'string',
              timeline: [
                {
                  id: 'string',
                  start: 'string',
                  duration: 'string',
                  trackIndex: 'number',
                  caption: 'string',
                },
              ],
            },
            hyperframesHtml: 'standalone HyperFrames composition HTML string',
            meta: localPlan.meta,
          },
          baseline: localPlan,
        },
        null,
        2,
      ),
    },
  ];
}

async function proxyToRelay(input) {
  const relayUrl = resolveRelayUrl(input);
  const localPlan = buildLocalPlan(input);
  if (!relayUrl) {
    return {
      ok: true,
      source: 'local',
      relay: { enabled: false, url: '' },
      plan: localPlan,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(DEFAULT_API_KEY ? { Authorization: `Bearer ${DEFAULT_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.4,
        messages: buildRelayPrompt(input, localPlan),
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    const parsed = cleanJson(rawText);
    const content =
      extractRelayText(rawText) ||
      parsed?.choices?.[0]?.message?.content ||
      parsed?.content ||
      rawText;
    const plan = cleanJson(content) || parsed || localPlan;

    return {
      ok: response.ok,
      source: response.ok ? 'relay' : 'local_fallback',
      relay: {
        enabled: true,
        url: relayUrl,
        status: response.status,
      },
      plan: normalizePlan(plan, localPlan),
      raw: response.ok ? undefined : rawText,
      error: response.ok ? undefined : `cc-relay returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      source: 'local_fallback',
      relay: {
        enabled: true,
        url: relayUrl,
      },
      plan: localPlan,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePlan(plan, fallback) {
  if (!plan || typeof plan !== 'object') return fallback;
  const scenes = Array.isArray(plan.scenes) && plan.scenes.length ? plan.scenes : fallback.scenes;
  const hyperframes =
    plan.hyperframes && typeof plan.hyperframes === 'object' ? plan.hyperframes : fallback.hyperframes;
  return {
    projectTitle: plan.projectTitle || fallback.projectTitle,
    brief: plan.brief || fallback.brief,
    outline: Array.isArray(plan.outline) && plan.outline.length ? plan.outline : fallback.outline,
    scenes,
    storyboard: Array.isArray(plan.storyboard) && plan.storyboard.length ? plan.storyboard : scenes,
    payload: fallback.payload,
    hyperframes: hyperframes || fallback.hyperframes,
    hyperframesHtml:
      typeof plan.hyperframesHtml === 'string' && plan.hyperframesHtml.trim()
        ? plan.hyperframesHtml
        : fallback.hyperframesHtml,
    meta: {
      ...fallback.meta,
      ...(plan.meta && typeof plan.meta === 'object' ? plan.meta : {}),
    },
    relay: fallback.relay,
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function serveStatic(req, res, pathname) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, decodeURIComponent(normalized)));
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    });
  } catch {
    send(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    json(res, 200, {
      ok: true,
      relayConfigured: Boolean(resolveRelayUrl({ relayUrl: DEFAULT_RELAY_URL })),
      model: DEFAULT_MODEL,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    let input = null;
    try {
      const body = await readBody(req);
      const topic = String(body.topic || '').trim();
      input = {
        topic,
        duration: Number(body.duration || 60),
        style: String(body.style || '电影级'),
        audience: String(body.audience || '大众观众'),
        ratio: String(body.ratio || '16:9'),
        relayUrl: String(body.relayUrl || DEFAULT_RELAY_URL || ''),
      };

      if (!input.topic) {
        json(res, 400, { ok: false, error: 'topic is required' });
        return;
      }

      const result = await proxyToRelay(input);
      json(res, 200, result);
    } catch (error) {
      const fallbackInput =
        input || {
          topic: '',
          duration: 60,
          style: '电影级',
          audience: '大众观众',
          ratio: '16:9',
          relayUrl: DEFAULT_RELAY_URL,
        };
      json(res, 200, {
        ok: false,
        source: 'local_fallback',
        relay: {
          enabled: Boolean(resolveRelayUrl(fallbackInput)),
          url: resolveRelayUrl(fallbackInput),
        },
        plan: buildLocalPlan(fallbackInput),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  await serveStatic(req, res, url.pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Visora AI is running at http://127.0.0.1:${PORT}`);
});
