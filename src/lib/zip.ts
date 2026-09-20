/**
 * 最小 ZIP 打包器（store 模式，不压缩）。
 *
 * 为什么不引依赖：PNG 本身就是 deflate 过的，再压一遍几乎不减小体积，
 * 所以只需要「打包」而不需要「压缩」。store-only 的 ZIP 结构简单到
 * 可以手写——本地文件头 + 中央目录 + EOCD，加起来不到 100 行。
 *
 * 格式依据 PKWARE APPNOTE：每个文件一条 Local File Header + 数据，
 * 末尾一组 Central Directory File Header，最后是 End of Central Directory。
 */

export interface ZipEntry {
  /** 压缩包内的文件名（含扩展名） */
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** ZIP 里的时间戳用 DOS 格式（秒只有 2 秒精度，1980 年起算） */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** 文件名统一按 UTF-8 写，并置 UTF-8 标志位（bit 11），避免中文名乱码 */
function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

export function buildZip(entries: ZipEntry[], now = new Date()): Blob {
  const { time, date } = dosDateTime(now)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = utf8(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // 本地文件头签名
    lv.setUint16(4, 20, true) // 需要的解压版本 2.0
    lv.setUint16(6, 0x0800, true) // 标志位：文件名是 UTF-8
    lv.setUint16(8, 0, true) // 压缩方法 0 = store
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true) // 压缩后大小 = 原始大小
    lv.setUint32(22, size, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // 扩展字段长度
    local.set(nameBytes, 30)
    locals.push(local, entry.data)

    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // 中央目录头签名
    cv.setUint16(4, 20, true) // 创建版本
    cv.setUint16(6, 20, true) // 解压版本
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // 扩展字段
    cv.setUint16(32, 0, true) // 注释
    cv.setUint16(34, 0, true) // 起始磁盘号
    cv.setUint16(36, 0, true) // 内部属性
    cv.setUint32(38, 0, true) // 外部属性
    cv.setUint32(42, offset, true) // 本地文件头的偏移
    central.set(nameBytes, 46)
    centrals.push(central)

    offset += local.length + size
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true) // EOCD 签名
  ev.setUint16(4, 0, true) // 当前磁盘号
  ev.setUint16(6, 0, true) // 中央目录起始磁盘号
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true) // 中央目录偏移
  ev.setUint16(20, 0, true) // 注释长度

  // 直接把这些分片交给 Blob，**不要**先拼成一整块 Uint8Array：
  // 单张 PNG 在 pixelRatio 3 下就有几 MB 到几十 MB，批量导出时先拼一份等于
  // 峰值内存翻倍。Blob 接受分片数组，浏览器会自己管理，不需要额外拷贝。
  const parts = [...locals, ...centrals, eocd] as unknown as BlobPart[]
  return new Blob(parts, { type: 'application/zip' })
}

/** 压缩包里不允许出现路径分隔符与重复名；这里做一次清理与去重 */
export function safeZipName(name: string, used: Set<string>): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'card'
  let candidate = cleaned
  let n = 2
  while (used.has(candidate)) {
    const dot = cleaned.lastIndexOf('.')
    candidate = dot > 0 ? `${cleaned.slice(0, dot)}-${n}${cleaned.slice(dot)}` : `${cleaned}-${n}`
    n++
  }
  used.add(candidate)
  return candidate
}

// ------------------------------------------------------------------ 读取

/**
 * 读取 ZIP。
 *
 * 两个刻意的实现选择：
 *  1. **逐条 slice 读取，不把整个压缩包读进内存**。备份包里可能有几百 MB 音频，
 *     一次性 `arrayBuffer()` 等于峰值内存翻倍——而这个功能的场景恰恰是"库很大、
 *     该做备份了"。所以先只读中央目录，再按需 slice 每一条。
 *  2. **同时支持 store(0) 与 deflate(8)**。我们自己导出的是 store，但用户可能
 *     用别的工具重新压过一遍；deflate 走浏览器的 DecompressionStream，不用引依赖。
 */
export async function readZip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>()

  // 1) 找 EOCD：从尾部往前扫（注释最长 65535 字节）
  const tailLen = Math.min(blob.size, 65557)
  const tailStart = blob.size - tailLen
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer())
  const tv = new DataView(tail.buffer)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('这不是一个 ZIP 文件（找不到中央目录）')

  const entryCount = tv.getUint16(eocd + 10, true)
  const cdSize = tv.getUint32(eocd + 12, true)
  const cdOffset = tv.getUint32(eocd + 16, true)

  // 2) 中央目录一次读进来（很小）
  const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer())
  const cv = new DataView(cd.buffer)
  let p = 0
  for (let i = 0; i < entryCount; i++) {
    if (cv.getUint32(p, true) !== 0x02014b50) break
    const method = cv.getUint16(p + 10, true)
    const compSize = cv.getUint32(p + 20, true)
    const nameLen = cv.getUint16(p + 28, true)
    const extraLen = cv.getUint16(p + 30, true)
    const commentLen = cv.getUint16(p + 32, true)
    const localOffset = cv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen))

    // 3) 读本地文件头，算出数据起点（本地头的 name/extra 长度可能与中央目录不同）
    const lh = new Uint8Array(await blob.slice(localOffset, localOffset + 30).arrayBuffer())
    const lv = new DataView(lh.buffer)
    if (lv.getUint32(0, true) !== 0x04034b50) throw new Error(`ZIP 结构损坏：条目 ${name} 的本地头无效`)
    const lNameLen = lv.getUint16(26, true)
    const lExtraLen = lv.getUint16(28, true)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen

    if (!name.endsWith('/') && compSize > 0) {
      const raw = new Uint8Array(await blob.slice(dataStart, dataStart + compSize).arrayBuffer())
      out.set(name, method === 0 ? raw : await inflateRaw(raw))
    } else if (!name.endsWith('/')) {
      out.set(name, new Uint8Array(0))
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('这个 ZIP 用了压缩，而当前浏览器不支持解压（请用本应用导出的备份）')
  }
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
