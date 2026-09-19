import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ImagePlus, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { MAX_SCRIM, MIN_SCRIM, SCENE_FIELD_META } from '../../shared/scene'
import type { SceneState } from '../lib/useScene'

/**
 * 诗词卡专用：把一首诗拆成五个独立画面字段，拼成提示词，生成背景图。
 * 字段可手改——自动拆解只是给个起点，最终提示词始终以面板上的内容为准。
 */
export function ScenePanel({ scene }: { scene: SceneState }) {
  const { fields, filled, ready, prompt, background, dissecting, generating } = scene
  const busy = dissecting || generating

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-widest text-ink-400">
          AI 背景
        </div>
        <span className="text-[11px] tabular-nums text-ink-400">{filled}/5</span>
      </div>

      <div className="flex flex-col gap-2.5">
        {SCENE_FIELD_META.map((meta) => (
          <div key={meta.key}>
            <label className="mb-1 flex items-baseline gap-1.5">
              <span className="text-xs font-medium text-ink-700">{meta.label}</span>
              <span className="text-[11px] text-ink-400">{meta.hint}</span>
            </label>
            <textarea
              value={fields[meta.key]}
              onChange={(e) => scene.setField(meta.key, e.target.value)}
              placeholder={meta.placeholder}
              rows={2}
              spellCheck={false}
              className="w-full resize-y rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-ink-800 outline-none transition placeholder:text-ink-300 focus:border-ink-600"
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void scene.dissect()}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-ink-200 bg-white px-2 py-2 text-xs font-medium text-ink-700 transition hover:border-ink-300 hover:text-ink-900 disabled:opacity-50"
        >
          {dissecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {dissecting ? '拆解中…' : '自动拆解'}
        </button>
        <button
          onClick={() => void scene.generate()}
          disabled={busy || !ready}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-ink-800 px-2 py-2 text-xs font-medium text-white transition hover:bg-ink-900 disabled:opacity-40"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
          {generating ? '生成中…' : '生成背景'}
        </button>
      </div>

      {prompt && <PromptPreview prompt={prompt} />}

      {background && (
        <div className="mt-3 rounded-md border border-ink-200 bg-white p-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <img
              src={background.dataUrl}
              alt="生成的背景图"
              className="h-10 w-10 shrink-0 rounded border border-ink-200 object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-ink-500">
                  蒙层 {Math.round(background.scrim * 100)}%
                </span>
                <button
                  onClick={scene.removeBackground}
                  title="移除背景图"
                  className="flex items-center gap-1 text-[11px] text-ink-400 transition hover:text-seal"
                >
                  <Trash2 className="h-3 w-3" />
                  移除
                </button>
              </div>
              <input
                type="range"
                min={MIN_SCRIM}
                max={MAX_SCRIM}
                step={0.01}
                value={background.scrim}
                onChange={(e) => scene.setScrim(Number(e.target.value))}
                className="mt-1 w-full accent-ink-800"
                aria-label="背景蒙层强度"
              />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-400">
            蒙层用当前主题的渐变盖在图上：调高文字更清晰，调低照片更可见。
          </p>
        </div>
      )}
    </section>
  )
}

function PromptPreview({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      // 剪贴板不可用（非 https / 无权限）时保持原状，用户可以手动选中
    }
  }

  return (
    <details className="mt-3 rounded-md border border-ink-200 bg-white">
      <summary className="cursor-pointer select-none px-2.5 py-2 text-[11px] text-ink-500">
        提示词预览
      </summary>
      <div className="border-t border-ink-100 p-2.5">
        <textarea
          readOnly
          value={prompt}
          rows={7}
          spellCheck={false}
          className="w-full resize-y rounded border border-ink-100 bg-ink-50 p-2 font-mono text-[11px] leading-relaxed text-ink-600 outline-none"
        />
        <button
          onClick={() => void copy()}
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border border-ink-200 px-2 py-1.5 text-[11px] text-ink-600 transition hover:border-ink-300 hover:text-ink-800"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? '已复制' : '复制提示词'}
        </button>
      </div>
    </details>
  )
}
