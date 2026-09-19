/**
 * 可选的文字字体。
 *
 * 只暴露项目已经 self-host 的字体（都在 main.tsx 或本文件的懒加载表里引入），
 * 不引入任何外部字体请求——否则导出的 PNG 会因为字体没加载而回退系统字体，
 * 屏幕预览和导出结果就不一致了。
 *
 * 全部按 unicode-range 分片，浏览器只取当前文字真正命中的分片。
 * 注意「最大单片小」不等于「下载少」：霞鹜文楷最大单片只有 60KB，但它切成了
 * 582 片，一首 20 字的诗要拉 97 片、约 4.4MB；而站酷系列只需 12 片、约 0.8MB。
 * 判断字体贵不贵，要看「命中多少片 × 每片多大」，不能只看最大单片。
 *
 * 中文字形在所有字体里都是全角等宽，换字体只改字形、不改宽度——
 * 所以「有没有生效」要靠字形判断，不能靠排版尺寸。
 */

export type FontKey =
  | 'default'
  | 'song'
  | 'wenkai'
  | 'hei'
  | 'kai'
  | 'xiaowei'
  | 'kuaile'
  | 'qingke'
  | 'longcang'
  | 'xingshu'
  | 'caoshu'
  | 'dongfang'
  | 'smiley'
  | 'fzkai'
  | 'fzfs'
  | 'xihei'
  | 'yozai'
  | 'xiaolai'
  | 'honglei'
  | 'zhuoshu'
  | 'zhuyuan'
  | 'wufeng'
  | 'longzhu'
  | 'jiagu'
  | 'mono'
  | 'serifEn'
  | 'garamond'
  | 'playfair'
  | 'cormorant'
  | 'lora'
  | 'caveat'
  | 'vibes'
  | 'plex'
  | 'manrope'

export type FontGroup = '中文' | '西文'

export const FONT_GROUP_ORDER: FontGroup[] = ['中文', '西文']

export interface FontOption {
  key: FontKey
  label: string
  hint: string
  /** undefined 表示沿用各卡片自己的默认字体栈 */
  family?: string
  group: FontGroup
}

export const FONT_OPTIONS: FontOption[] = [
  // ---------------- 中文 ----------------
  { key: 'default', label: '默认', hint: '各卡片自己的排版', group: '中文' },
  {
    key: 'song',
    label: '宋体',
    hint: '思源宋体（诗词正文的默认字体，选它不会有变化）',
    family: '"Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'wenkai',
    label: '文楷',
    hint: '霞鹜文楷，仿宋楷体，比宋体更有手写气（首次选中要下约 4.4MB）',
    family: '"LXGW WenKai", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'hei',
    label: '黑体',
    hint: '思源黑体，现代清爽',
    family: '"Noto Sans SC Variable", "Inter", system-ui, sans-serif',
    group: '中文',
  },
  {
    key: 'xihei',
    label: '晰黑',
    hint: '霞鹜新晰黑，笔画干净、横细竖粗',
    family: '"LXGW Neo XiHei", "Noto Sans SC Variable", sans-serif',
    group: '中文',
  },
  {
    key: 'kai',
    label: '楷书',
    hint: '马善政毛笔楷书，诗词标题的默认字体',
    family: '"Ma Shan Zheng", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'fzkai',
    label: '楷体',
    hint: '方正楷体，标准书刊楷体',
    family: '"FZKai-Z03", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'fzfs',
    label: '仿宋',
    hint: '方正仿宋，公文与诗词正文都常见',
    family: '"FZFangSong-Z02S", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'dongfang',
    label: '大楷',
    hint: '阿里妈妈东方大楷，笔势开张，适合大字号标题',
    family: '"Alimama DongFangDaKai", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'xiaowei',
    label: '小薇',
    hint: '站酷小薇，清秀仿宋',
    family: '"ZCOOL XiaoWei", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'zhuyuan',
    label: '珠圆',
    hint: '猫啃珠圆体，圆润规整',
    family: '"MaokenZhuyuanTi", "Noto Sans SC Variable", sans-serif',
    group: '中文',
  },
  {
    key: 'kuaile',
    label: '快乐',
    hint: '站酷快乐体，圆润活泼',
    family: '"ZCOOL KuaiLe", "Noto Sans SC Variable", sans-serif',
    group: '中文',
  },
  {
    key: 'qingke',
    label: '庆科',
    hint: '站酷庆科黄油体，圆润粗壮，适合短句',
    family: '"ZCOOL QingKe HuangYou", "Noto Sans SC Variable", sans-serif',
    group: '中文',
  },
  {
    key: 'smiley',
    label: '得意',
    hint: '得意黑，现代斜切，适合短句与标题',
    family: '"Smiley Sans Oblique", "Noto Sans SC Variable", sans-serif',
    group: '中文',
  },
  {
    key: 'wufeng',
    label: '无锋',
    hint: 'MdMd 无锋体，方正厚重',
    family: '"MDMD-WuFengTi", "Noto Sans SC Variable", sans-serif',
    group: '中文',
  },
  {
    key: 'longzhu',
    label: '龙珠',
    hint: '龙珠体，装饰性强，适合标题',
    family: '"LogoSC LongZhuTi ZHS", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'longcang',
    label: '龙藏',
    hint: '硬笔手写体，偏秀气',
    family: '"Long Cang", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'yozai',
    label: '悠哉',
    hint: '悠哉字体，手写感温和',
    family: '"Yozai", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'xiaolai',
    label: '小赖',
    hint: '小赖字体，圆头手写',
    family: '"Xiaolai SC", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'xingshu',
    label: '行书',
    hint: '志莽行书，连笔感强',
    family: '"Zhi Mang Xing", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'honglei',
    label: '弘雷',
    hint: '弘雷行书，毛笔连笔',
    family: '"hongleixingshu", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'zhuoshu',
    label: '拙书',
    hint: '弘雷拙书，古拙生涩',
    family: '"HongLeiZhuoShu", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'caoshu',
    label: '草书',
    hint: '柳建毛草，狂放难认，适合短句',
    family: '"Liu Jian Mao Cao", "Noto Serif SC Variable", serif',
    group: '中文',
  },
  {
    key: 'jiagu',
    label: '甲骨',
    hint: '方正甲骨文，古意浓，辨识度低，适合标题点缀',
    family: '"FZJiaGuWen", "Noto Serif SC Variable", serif',
    group: '中文',
  },

  // ---------------- 西文 ----------------
  {
    key: 'mono',
    label: '等宽',
    hint: 'JetBrains Mono（代码卡默认）',
    family: '"JetBrains Mono", ui-monospace, monospace',
    group: '西文',
  },
  {
    key: 'plex',
    label: 'Plex',
    hint: 'IBM Plex Mono，比 JetBrains 清瘦',
    family: '"IBM Plex Mono", ui-monospace, monospace',
    group: '西文',
  },
  {
    key: 'serifEn',
    label: 'Fraunces',
    hint: '英文衬线，金句/长文标题默认',
    family: '"Fraunces Variable", "Noto Serif SC Variable", serif',
    group: '西文',
  },
  {
    key: 'garamond',
    label: 'Garamond',
    hint: 'EB Garamond，古典书卷气',
    family: '"EB Garamond", "Noto Serif SC Variable", serif',
    group: '西文',
  },
  {
    key: 'cormorant',
    label: 'Cormorant',
    hint: '纤细优雅，适合大字号英文标题',
    family: '"Cormorant Garamond", "Noto Serif SC Variable", serif',
    group: '西文',
  },
  {
    key: 'lora',
    label: 'Lora',
    hint: '英文正文衬线，久读不累',
    family: '"Lora", "Noto Serif SC Variable", serif',
    group: '西文',
  },
  {
    key: 'playfair',
    label: 'Playfair',
    hint: 'Playfair Display，粗细对比强',
    family: '"Playfair Display", "Noto Serif SC Variable", serif',
    group: '西文',
  },
  {
    key: 'manrope',
    label: 'Manrope',
    hint: '几何无衬线，现代感',
    family: '"Manrope", "Noto Sans SC Variable", sans-serif',
    group: '西文',
  },
  {
    key: 'caveat',
    label: 'Caveat',
    hint: '手写体，适合署名或批注',
    family: '"Caveat", "Noto Sans SC Variable", cursive',
    group: '西文',
  },
  {
    key: 'vibes',
    label: 'Vibes',
    hint: 'Great Vibes，花体连笔，适合装饰性英文',
    family: '"Great Vibes", "Noto Serif SC Variable", cursive',
    group: '西文',
  },
]

/**
 * 这些字体没有中文字形，正文是中文时选了等于没变（会回落到后面的中文字体）。
 * 面板上给出提示，免得又出现「改了没反应」。
 */
export const LATIN_ONLY_KEYS: FontKey[] = [
  'mono',
  'plex',
  'serifEn',
  'garamond',
  'cormorant',
  'lora',
  'playfair',
  'manrope',
  'caveat',
  'vibes',
]

const KEYS = new Set<string>(FONT_OPTIONS.map((o) => o.key))

/**
 * 字号倍率的可调范围。
 * 上限刻意不放到 2：卡片高度是固定的（3:4 / 16:9），字号放大一倍必然溢出被裁，
 * 与其让用户撞上截断提示，不如把范围收在「还能装下」的区间，让他靠 自适应 尺寸
 * 去争取更多空间。
 */
export const FONT_SCALE_MIN = 0.7
export const FONT_SCALE_MAX = 1.5

export function isFontKey(v: unknown): v is FontKey {
  return typeof v === 'string' && KEYS.has(v)
}

/** 解析成可直接塞进 style.fontFamily 的值；'default' 返回 undefined */
export function fontFamilyOf(key: FontKey): string | undefined {
  return FONT_OPTIONS.find((o) => o.key === key)?.family
}

export function fontLabelOf(key: FontKey): string {
  return FONT_OPTIONS.find((o) => o.key === key)?.label ?? '默认'
}

export function fontHintOf(key: FontKey): string {
  return FONT_OPTIONS.find((o) => o.key === key)?.hint ?? ''
}

/**
 * 可选字体的 CSS 按需加载。
 *
 * 这些字体的 @font-face 规则合计上千条（每个中文字体按 unicode-range 切
 * 60–600 片）。全部静态 import 会让 CSS 从 269KB 涨到 MB 级，而绝大多数访客
 * 只会用默认那几套。所以改成选中时才动态 import——Vite 会为每个包单独切一个
 * CSS chunk，不选就不下载。
 *
 * 默认字体（Fraunces / Inter / JetBrains Mono / Noto Serif SC / Ma Shan Zheng）
 * 仍然在 main.tsx 里静态引入，它们是各卡片的默认排版。
 *
 * cn-fontsource-* 系列的入口是 font.css（用 cn-font-split 预先切好片）。
 */
const LAZY_FONT_CSS: Partial<Record<FontKey, () => Promise<unknown>>> = {
  hei: () => import('@fontsource-variable/noto-sans-sc/index.css'),
  xiaowei: () => import('@fontsource/zcool-xiaowei/400.css'),
  kuaile: () => import('@fontsource/zcool-kuaile/400.css'),
  qingke: () => import('@fontsource/zcool-qingke-huangyou/400.css'),
  longcang: () => import('@fontsource/long-cang/400.css'),
  xingshu: () => import('@fontsource/zhi-mang-xing/400.css'),
  caoshu: () => import('@fontsource/liu-jian-mao-cao/400.css'),
  dongfang: () => import('cn-fontsource-alimama-dong-fang-da-kai-regular/font.css'),
  smiley: () => import('cn-fontsource-smiley-sans-oblique-regular/font.css'),
  fzkai: () => import('cn-fontsource-fz-kai-z-03-regular/font.css'),
  fzfs: () => import('cn-fontsource-fz-fang-song-z-02-s-regular/font.css'),
  xihei: () => import('cn-fontsource-lxgw-neo-xi-hei-regular/font.css'),
  yozai: () => import('cn-fontsource-yozai-regular/font.css'),
  xiaolai: () => import('cn-fontsource-xiaolai-sc-regular/font.css'),
  honglei: () => import('cn-fontsource-hongleixingshu-regular/font.css'),
  zhuoshu: () => import('cn-fontsource-hong-lei-zhuo-shu-regular/font.css'),
  zhuyuan: () => import('cn-fontsource-maoken-zhuyuan-ti-regular/font.css'),
  wufeng: () => import('cn-fontsource-mdmd-wu-feng-ti-regular/font.css'),
  longzhu: () => import('cn-fontsource-logo-sc-long-zhu-ti-zhs-regular/font.css'),
  jiagu: () => import('cn-fontsource-fz-jia-gu-wen-regular/font.css'),
  plex: () => import('@fontsource/ibm-plex-mono/400.css'),
  garamond: () => import('@fontsource/eb-garamond/400.css'),
  cormorant: () => import('@fontsource/cormorant-garamond/400.css'),
  lora: () => import('@fontsource/lora/400.css'),
  playfair: () => import('@fontsource/playfair-display/400.css'),
  manrope: () => import('@fontsource/manrope/400.css'),
  caveat: () => import('@fontsource/caveat/400.css'),
  vibes: () => import('@fontsource/great-vibes/400.css'),
  /**
   * 霞鹜文楷用 lxgw-wenkai-webfont 而不是 @fontsource/lxgw-wenkai：
   * 后者**没有按 unicode-range 分片**，单个 woff2 就有 6.9–8.4MB（而且文件名
   * 叫 latin 却装了整套中日韩字形，标签是错的），选一次要下 8MB。
   * lxgw-wenkai-webfont 是官方为网页做的版本：582 个分片、最大单片 60KB，
   * 一首诗实测要拉 97 片 / 约 4.4MB——仍然比前者省一半，是目前能拿到的最好版本。
   * 正体 + 粗体一起加载，避免标题被浏览器合成假粗体（中文假粗体会发糊）。
   */
  wenkai: () =>
    Promise.all([
      import('lxgw-wenkai-webfont/lxgwwenkai-regular.css'),
      import('lxgw-wenkai-webfont/lxgwwenkai-bold.css'),
    ]),
}

const attempted = new Set<FontKey>()

/**
 * 确保某档字体的 CSS 已注入。重复调用只会真正加载一次。
 * 失败时会把记录清掉，允许下次重试。
 */
export async function ensureFontLoaded(key: FontKey): Promise<void> {
  if (attempted.has(key)) return
  attempted.add(key)
  const load = LAZY_FONT_CSS[key]
  if (!load) return
  try {
    await load()
  } catch (err) {
    // 不能静默吞掉：加载失败会表现成「选了字体但预览没变化」，极难排查。
    // 清掉记录以便下次重试，同时把原因打出来。
    attempted.delete(key)
    console.warn('[fonts] 按需加载字体 CSS 失败：', key, err)
  }
}
