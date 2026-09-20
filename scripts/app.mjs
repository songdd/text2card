#!/usr/bin/env node
/**
 * 一键启动：起本地服务 + 自动打开浏览器。
 *
 * 为什么要它：这个应用的数据住在**本机的 SQLite 文件**里，所以必须先有一个本地服务
 * 才能看到自己的卡片。以前这意味着"打开终端、cd 到目录、敲 npm run dev、再自己开
 * 浏览器"——四步里任何一步出错，用户看到的都是一个打不开的页面。
 *
 * 这个脚本做四件事：
 *   1. 自检 Node 版本（`node:sqlite` 需要 23.4+，旧版本会直接给出人话提示）
 *   2. 已经在跑就直接开浏览器（重复执行不会起第二个服务、也不会报端口占用）
 *   3. 没在跑就把 Vite 起起来，等它真的能响应了再开浏览器（不是瞎等固定秒数）
 *   4. 顺便打印局域网地址——同一个 WiFi 下手机/平板能打开同一份库
 *
 * 参数：`--no-open` 只起服务不开浏览器（自检/服务器环境用）。
 */
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PORT = 5173
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const LOCAL = `http://localhost:${PORT}/`
const STATUS = `http://127.0.0.1:${PORT}/api/library/status`
const NO_OPEN = process.argv.includes('--no-open')

/** `node:sqlite` 从 23.4 起不再需要实验开关 */
const MIN_NODE = [23, 4]

function nodeTooOld() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  return major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])
}

/** 局域网地址：手机/平板访问用 */
function lanUrls() {
  const out = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(`http://${ni.address}:${PORT}/`)
    }
  }
  return out
}

function openBrowser(url) {
  const cmd =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref()
    return true
  } catch {
    return false
  }
}

async function serverAlive(timeoutMs = 1200) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(STATUS, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function banner() {
  console.log('')
  console.log('  ╭──────────────────────────────────────────────╮')
  console.log('  │  奕霖古诗词 · 本地服务                        │')
  console.log('  ╰──────────────────────────────────────────────╯')
}

async function main() {
  if (nodeTooOld()) {
    console.error(`\n这个应用需要 Node ${MIN_NODE.join('.')} 或更高（当前 ${process.versions.node}）。`)
    console.error('  原因是它用 Node 内置的 node:sqlite 存数据，低版本里这个模块还不存在。')
    console.error('  到 https://nodejs.org 装一个 LTS 版本再运行即可。\n')
    process.exit(1)
  }

  const running = await serverAlive()
  if (running) {
    banner()
    console.log(`  服务已经在跑了（${running.cards ?? '?'} 张卡片、${running.imageFiles ?? 0} 张配图、${running.audioFiles ?? 0} 个音频）`)
    console.log(`  地址：${LOCAL}`)
    for (const url of lanUrls()) console.log(`  局域网：${url}`)
    if (!NO_OPEN) openBrowser(LOCAL)
    console.log('')
    return
  }

  banner()
  console.log(`  正在启动本地服务（数据目录：data/）…`)
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT)],
    { cwd: ROOT, stdio: 'inherit' },
  )

  // 等它真的能应答再开浏览器：固定 sleep 在慢机器上会开出"连不上"的页面
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) break
    const info = await serverAlive(800)
    if (info) {
      ready = true
      console.log('')
      console.log(`  就绪：${info.cards ?? 0} 张卡片 · ${info.imageFiles ?? 0} 张配图 · ${info.audioFiles ?? 0} 个音频`)
      console.log(`  地址：${LOCAL}`)
      for (const url of lanUrls()) console.log(`  同一 WiFi 下手机可访问：${url}`)
      console.log('  关掉这个窗口（或按 Ctrl+C）即停止服务。')
      console.log('')
      if (!NO_OPEN) openBrowser(LOCAL)
      break
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  if (!ready && child.exitCode === null) {
    console.log('  服务还在启动中（没等到应答）。浏览器可以先手动打开：' + LOCAL)
  }
  if (child.exitCode !== null && child.exitCode !== 0) {
    console.error(`\n服务没能起来（退出码 ${child.exitCode}）。`)
    console.error(`  如果是"端口 ${PORT} 被占用"，请先关掉另一个占用它的程序再试。\n`)
    process.exit(child.exitCode ?? 1)
  }

  // 保持前台运行：关掉这个窗口就等于停止服务
  const stop = () => {
    try {
      child.kill()
    } catch {
      // 已经退了
    }
  }
  process.on('SIGINT', () => {
    stop()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    stop()
    process.exit(0)
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}

main().catch((err) => {
  console.error('启动失败：', err instanceof Error ? err.message : err)
  process.exit(1)
})
