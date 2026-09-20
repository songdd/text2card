/**
 * 浏览器存储用量与持久化授权。
 *
 * 为什么需要它：快照库里每条都可能带一张 1–5MB 的 AI 配图，**保存已不设条数上限**。
 * 这意味着两件事：
 *   1. 用户需要看得见增长，否则某天保存失败才发现；
 *   2. 浏览器默认把 IndexedDB 当 "best-effort" 存储，磁盘紧张时可以**不经询问
 *      直接清掉**。存得越多，被清掉的损失越大，所以应该主动申请持久化授权。
 */

export interface StorageInfo {
  /** 本站已用字节数 */
  usage: number
  /** 配额字节数（浏览器给的估算值，不保证精确） */
  quota: number
  /** 是否已获得持久化授权（授权后不会被自动清理） */
  persisted: boolean
  /** 当前环境是否支持这些 API（Safari 老版本、隐私模式可能没有） */
  supported: boolean
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const unsupported: StorageInfo = { usage: 0, quota: 0, persisted: false, supported: false }
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return unsupported
  try {
    const est = await navigator.storage.estimate()
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false
    return {
      usage: est.usage ?? 0,
      quota: est.quota ?? 0,
      persisted,
      supported: true,
    }
  } catch {
    return unsupported
  }
}

/**
 * 申请持久化存储。浏览器可能直接拒绝（比如站点参与度不够、或用的是隐身模式），
 * 所以返回布尔值而不是抛错，由界面如实显示结果。
 */
export async function requestPersist(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
