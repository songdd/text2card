import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// 字体 self-host（@fontsource，CJK 按 unicode-range 分片按需加载）。
// 字重按实际使用裁剪，新增字重用法时记得在这里补 import。
import '@fontsource-variable/fraunces' // wght + opsz 可变，family 名为 'Fraunces Variable'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
// 注意：必须用变量字体版。静态版（@fontsource/noto-serif-sc）的 500 字重
// 分片打包有问题（内部命名错乱，Chrome 加载后拒用，CJK 回退黑体）
import '@fontsource-variable/noto-serif-sc' // wght 200-900，family 'Noto Serif SC Variable'
import '@fontsource/ma-shan-zheng/400.css'
// 「字体」面板里那些**可选的**字体不在这里 import：它们的 @font-face 规则
// 加起来有 600 多条，全量静态引入会把 CSS 从 266KB 顶到 1086KB（gzip 107→490KB），
// 每个访客都要为「可能永远不会选的字体」付这笔钱。
// 改为选中时按需加载，见 lib/fonts.ts 的 ensureFontLoaded()。
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
