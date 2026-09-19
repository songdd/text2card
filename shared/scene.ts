/**
 * 「诗词 → 五个独立字段 → 提示词」的领域模型。
 *
 * 前后端共用：前端渲染编辑面板、拼装提示词；服务端按同一份字段元数据
 * 构造拆解模型的结构化输出要求，避免两边描述漂移。
 */

export interface SceneFields {
  /** 主体：画面里唯一的核心实体 */
  subject: string
  /** 环境：主体所处的时空、天气与陪衬景物 */
  environment: string
  /** 风格：绘画媒介与流派 */
  style: string
  /** 光影：光源方向、强度与色调氛围 */
  lighting: string
  /** 构图：取景视角、主体位置、留白分布 */
  composition: string
}

export const SCENE_KEYS = ['subject', 'environment', 'style', 'lighting', 'composition'] as const
export type SceneKey = (typeof SCENE_KEYS)[number]

export interface SceneFieldMeta {
  key: SceneKey
  /** 面板上的字段名 */
  label: string
  /** 面板上的一句话说明 */
  hint: string
  /** 输入框占位示例 */
  placeholder: string
  /** 给拆解模型看的要求（服务端拼进 system prompt） */
  describe: string
}

export const SCENE_FIELD_META: SceneFieldMeta[] = [
  {
    key: 'subject',
    label: '主体',
    hint: '画面里最核心的那一个东西',
    placeholder: '一叶孤舟 / 归雁 / 半枝寒梅',
    describe: '画面唯一主体，写成可直接画出的实体（1 个主体，不要罗列多个），并带上它的状态或动作',
  },
  {
    key: 'environment',
    label: '环境',
    hint: '主体所处的时空与景物',
    placeholder: '寒江暮色，远山薄雾',
    describe: '主体所处的时间、季节、天气，以及远景/陪衬景物，用于交代空间纵深',
  },
  {
    key: 'style',
    label: '风格',
    hint: '绘画媒介与流派',
    placeholder: '水墨写意，淡彩渲染',
    describe: '绘画媒介与流派风格，如水墨写意、青绿山水、宋代院体工笔、淡彩没骨、留白文人画',
  },
  {
    key: 'lighting',
    label: '光影',
    hint: '光源方向与氛围',
    placeholder: '月华清冷，侧逆光，低对比',
    describe: '光源（日/月/烛/云隙光）、方向、强弱，以及整体色调冷暖与对比度',
  },
  {
    key: 'composition',
    label: '构图',
    hint: '取景与留白安排',
    placeholder: '竖幅三分法，主体偏右上，左侧大片留白',
    describe: '取景视角（平视/俯视/远眺）、主体在画面中的位置、留白分布与画面疏密',
  },
]

export const EMPTY_SCENE: SceneFields = {
  subject: '',
  environment: '',
  style: '',
  lighting: '',
  composition: '',
}

export function emptyScene(): SceneFields {
  return { ...EMPTY_SCENE }
}

export function hasSceneContent(scene: SceneFields): boolean {
  return SCENE_KEYS.some((k) => (scene[k] ?? '').trim() !== '')
}

/** 已填字段数，用于面板上给个「3/5」的进度提示 */
export function filledCount(scene: SceneFields): number {
  return SCENE_KEYS.filter((k) => (scene[k] ?? '').trim() !== '').length
}

const MAX_FIELD_LEN = 200

/**
 * 把任意来源（模型输出、localStorage 里的旧数据）收敛成合法的 SceneFields。
 * 模型偶尔会返回数组、嵌套对象或超长文本，这里一律降级为字符串并截断，
 * 避免脏数据一路流到提示词里。
 */
export function normalizeScene(input: unknown): SceneFields {
  const out = emptyScene()
  if (!input || typeof input !== 'object') return out
  const src = input as Record<string, unknown>
  for (const key of SCENE_KEYS) {
    const raw = src[key]
    let text = ''
    if (typeof raw === 'string') text = raw
    else if (Array.isArray(raw)) text = raw.filter((v) => typeof v === 'string').join('，')
    else if (raw && typeof raw === 'object') text = Object.values(raw).filter((v) => typeof v === 'string').join('，')
    out[key] = text.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_LEN)
  }
  return out
}

/** 卡片画幅，决定提示词里的画幅描述与出图尺寸 */
export type Aspect = 'portrait' | 'landscape' | 'square'

const ASPECT_TEXT: Record<Aspect, string> = {
  portrait: '竖版画幅（3:4）',
  landscape: '横版画幅（16:9）',
  square: '方形画幅（1:1）',
}

/**
 * 拼装最终提示词。
 *
 * 关键约束是「这张图要当文字卡片的底图」：所以除了五个字段，还必须
 * 强制声明留白诉求与禁止项（文字/印章/水印），否则模型很容易画出
 * 满构图、带题字或印章的画面，叠上卡片文字后完全不可读。
 */
export function composePrompt(scene: SceneFields, aspect: Aspect = 'portrait'): string {
  const parts: string[] = []
  for (const meta of SCENE_FIELD_META) {
    const v = (scene[meta.key] ?? '').trim()
    if (v) parts.push(`${meta.label}：${v}`)
  }
  if (!parts.length) return ''

  return [
    `${parts.join('；')}。`,
    `${ASPECT_TEXT[aspect]}，单幅完整画面，中国古典诗词意境配图，用作文字卡片的背景底图。`,
    '画面大面积保持干净、柔和、低对比、弱细节，为叠加其上的竖排文字留出可读的留白；主体不要居中占满画面，避开正中央与画面四边。',
    '禁止出现任何文字、汉字、书法、字母、数字、印章、落款、水印、logo、边框、装饰线与分割线。',
  ].join('\n')
}

export interface CardBackground {
  /** data URL。必须内联，远程 URL 会污染导出用的 canvas */
  dataUrl: string
  /** 主题渐变在照片之上的不透明度（0–1），越大照片越淡、文字越清晰 */
  scrim: number
}

/**
 * 蒙层浓度的默认值与可调范围。
 *
 * 初值固定 50% 而不是按图片明暗自动估算：自动估算出来的值（0.62–0.87）
 * 经常把照片压得几乎看不见，让人以为背景图没生效。固定值可预期，
 * 需要时拖滑杆即可。
 */
export const DEFAULT_SCRIM = 0.5
export const MIN_SCRIM = 0
export const MAX_SCRIM = 0.9
