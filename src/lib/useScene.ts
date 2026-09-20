import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SCRIM,
  composePrompt,
  emptyScene,
  filledCount,
  hasSceneContent,
  normalizeScene,
  type Aspect,
  type CardBackground,
  type SceneFields,
  type SceneKey,
} from '../../shared/scene'
import { dissectPoem, generateBackgroundImage } from './arkClient'
import { loadDraftBackground, saveDraftBackground } from './snapshots'

export interface SceneState {
  fields: SceneFields
  /** 已填字段数，用于面板上的 3/5 进度 */
  filled: number
  /** 是否至少有一个字段，决定「生成」按钮是否可用 */
  ready: boolean
  /** 当前五字段拼出的提示词（空字符串表示还没内容） */
  prompt: string
  background: CardBackground | null
  dissecting: boolean
  generating: boolean
  setField: (key: SceneKey, value: string) => void
  applyFields: (fields: SceneFields) => void
  resetFields: () => void
  dissect: () => Promise<void>
  generate: () => Promise<void>
  /** 直接替换背景（从「最近保存」恢复时用，不走生成流程） */
  setBackground: (background: CardBackground | null) => void
  removeBackground: () => void
  setScrim: (value: number) => void
}

interface Options {
  text: string
  title: string
  author: string
  aspect: Aspect
  /** localStorage 里恢复出来的字段 */
  initial?: SceneFields
  onNotify?: (kind: 'ok' | 'err', message: string) => void
}

export function useScene({ text, title, author, aspect, initial, onNotify }: Options): SceneState {
  const [fields, setFields] = useState<SceneFields>(() => normalizeScene(initial ?? emptyScene()))
  const [background, setBackground] = useState<CardBackground | null>(null)
  const [dissecting, setDissecting] = useState(false)
  const [generating, setGenerating] = useState(false)

  // notify / 文本上下文都放 ref：让下面这些 action 的引用保持稳定，
  // 否则每一次按键都会重建回调，ScenePanel 无法 memo。
  const notifyRef = useRef(onNotify)
  notifyRef.current = onNotify
  const ctxRef = useRef({ text, title, author, aspect })
  ctxRef.current = { text, title, author, aspect }

  const notify = useCallback((kind: 'ok' | 'err', message: string) => {
    notifyRef.current?.(kind, message)
  }, [])

  const setField = useCallback((key: SceneKey, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }))
  }, [])

  const applyFields = useCallback((next: SceneFields) => {
    setFields(normalizeScene(next))
  }, [])

  const resetFields = useCallback(() => {
    setFields(emptyScene())
  }, [])

  const prompt = useMemo(() => composePrompt(fields, aspect), [fields, aspect])
  const ready = hasSceneContent(fields)
  const filled = filledCount(fields)

  /**
   * 背景图的持久化。
   *
   * 背景图放不进 localStorage（一张就有 1–5MB，配额 5MB 直接爆），所以单独存
   * IndexedDB。少了这一步，「从『最近』载入快照 → 刷新页面」背景就会丢——
   * 因为刷新后只恢复 localStorage 里的草稿，而草稿里没有图。
   *
   * hydrated 这面旗很关键：读取是异步的，写回必须等它读完，否则刚读出来的
   * 图会被随后的「空值写回」立刻覆盖掉。
   */
  const hydrated = useRef(false)
  useEffect(() => {
    let cancelled = false
    loadDraftBackground()
      .then((saved) => {
        if (cancelled) return
        if (saved) setBackground(saved)
      })
      .catch(() => {
        // 隐私模式等场景读不到就算了，不该因此让整个页面报错
      })
      .finally(() => {
        hydrated.current = true
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated.current) return
    // 防抖：拖蒙层滑杆时每一帧都会改 background，不防抖等于每帧写一次几 MB
    const id = setTimeout(() => {
      void saveDraftBackground(background).catch((err) => {
        console.warn('[scene] 背景图保存失败：', err)
      })
    }, 500)
    return () => clearTimeout(id)
  }, [background])

  const dissect = useCallback(async () => {
    const { text: poem, title: t, author: a } = ctxRef.current
    if (!poem.trim()) {
      notify('err', '左侧还没有诗词正文')
      return
    }
    setDissecting(true)
    try {
      const scene = await dissectPoem({ text: poem, title: t || undefined, author: a || undefined })
      setFields(scene)
      notify('ok', `已拆解出 ${filledCount(scene)}/5 个画面字段`)
    } catch (err) {
      notify('err', `拆解失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDissecting(false)
    }
  }, [notify])

  const generate = useCallback(async () => {
    const { aspect: a } = ctxRef.current
    const finalPrompt = composePrompt(fields, a)
    if (!finalPrompt) {
      notify('err', '五个字段都还是空的，先拆解或手动填写')
      return
    }
    setGenerating(true)
    try {
      const image = await generateBackgroundImage(finalPrompt)
      setBackground({ dataUrl: image.dataUrl, scrim: DEFAULT_SCRIM })
      notify('ok', `背景图已生成${image.model ? `（${image.model}）` : ''}`)
    } catch (err) {
      notify('err', `生成失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGenerating(false)
    }
  }, [fields, notify])

  const removeBackground = useCallback(() => setBackground(null), [])

  const setScrim = useCallback((value: number) => {
    setBackground((prev) => (prev ? { ...prev, scrim: value } : prev))
  }, [])

  return {
    fields,
    filled,
    ready,
    prompt,
    background,
    dissecting,
    generating,
    setField,
    applyFields,
    resetFields,
    dissect,
    generate,
    setBackground,
    removeBackground,
    setScrim,
  }
}
