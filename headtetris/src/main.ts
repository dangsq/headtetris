import './style.css'
import { createFace, openCamera, makeMapper } from './trackers'
import { HeadInput } from './input'
import {
  COLS,
  ROWS,
  KINDS,
  PIECE_COLORS,
  Bag,
  newBoard,
  spawnPiece,
  collides,
  tryRotate,
  merge,
  fullRows,
  removeRows,
  dropY,
  pieceCells,
  pieceBounds,
  LINE_SCORE,
  gravityMs,
  type Piece,
  type Board,
} from './tetris'
import { nextEntry, showChronicle, FIRST_LINE_TEXT } from './chronicle'

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const video = $('cam') as HTMLVideoElement
const canvas = $('stage') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const bootEl = $('boot')
const hudEl = $('hud')
const hintEl = $('hint')
const chronicleEl = $('chronicle')

const DEBUG = new URLSearchParams(location.search).has('debug')
/** ?nocam：无摄像头渲染模式（出帧用）——跳过摄像头/模型，隐藏人物层 */
const NOCAM = new URLSearchParams(location.search).has('nocam')
/** ?frame=play：布景模式（出帧用）——预设一局游戏画面，冻结逻辑只渲染 */
const FRAME_PLAY = new URLSearchParams(location.search).get('frame') === 'play'
if (NOCAM || FRAME_PLAY) video.style.display = 'none'

const input = new HeadInput()

// ---------- 游戏状态 ----------
const bag = new Bag()
let board: Board = newBoard()
let piece: Piece | null = null
let nextKind = bag.next()
let score = 0
let lines = 0
let level = 1
let gravAcc = 0
let over = false
let phase: 'title' | 'playing' | 'over' = 'title'
let overAt = 0
let startedAt = 0

// 消行动画
let clearing: { rows: number[]; t: number } | null = null
// 震屏 & 粒子
let shake = 0
interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; size: number }
/** 丝缕：横向飘出的绸带碎片（消行专用） */
interface SilkP { x: number; y: number; vx: number; len: number; life: number; max: number; wob: number; alpha: number }
/** 整缕抽走的丝：飞向计分板（出丝入账） */
interface ThreadFly { x: number; y: number; tx: number; ty: number; t: number }
let particles: P[] = []
let silkStreamers: SilkP[] = []
let threadFlies: ThreadFly[] = []

function burst(px: number, py: number, hue: number, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const sp = 90 + Math.random() * 220
    particles.push({ x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 130, life: 0, max: 0.5 + Math.random() * 0.3, hue, size: 2 + Math.random() * 3 })
  }
}

/** 消行：一缕丝绸横飘（整行生成 3-4 条丝缕，左右飘出） */
function silkBurst(y: number, w: number) {
  const n = 3 + Math.floor(Math.random() * 2)
  for (let i = 0; i < n; i++) {
    const dir = Math.random() < 0.5 ? -1 : 1
    silkStreamers.push({
      x: w / 2 + dir * (Math.random() * 60 - 30),
      y: y + (Math.random() - 0.5) * 8,
      vx: dir * (120 + Math.random() * 160),
      len: 46 + Math.random() * 60,
      life: 0,
      max: 0.8 + Math.random() * 0.4,
      wob: Math.random() * Math.PI * 2,
      alpha: 0.5 + Math.random() * 0.3,
    })
  }
}

function reset() {
  board = newBoard()
  piece = null
  nextKind = bag.next()
  score = 0
  lines = 0
  level = 1
  gravAcc = 0
  over = false
  phase = 'playing'
  clearing = null
  particles = []
  silkStreamers = []
  threadFlies = []
  startedAt = performance.now()
  hintEl.classList.remove('hide')
}

/** 布景模式（?frame=play）：预设一局画面——高低错落的底堆 + 悬停竖直 I 锭。
 *  显式保证：无任何一行填满（11/11），避免出现「已被消掉的行」。 */
function setupFramePlay() {
  board = newBoard()
  // 各列底堆高度：col9 留为「井」（空一列，经典蓄势构图），其余高低错落
  const heights = [4, 3, 5, 3, 4, 3, 2, 3, 4, 0, 5]
  for (let x = 0; x < COLS; x++) {
    for (let h = 0; h < heights[x]; h++) {
      board[ROWS - 1 - h][x] = ((x + h) % 7) + 1
    }
  }
  // 自检：不允许满行
  for (let y = 0; y < ROWS; y++) {
    if (board[y].every((c) => c !== null)) {
      // 若命中（理论不会），把该行最后一列挖空兜底
      board[y][COLS - 1] = null
    }
  }
  // 活动块：竖直 I 锭（矩阵占第 1 列 → 棋盘列 = x+1 = 6），悬停在井槽上方
  piece = { kind: 'I', rot: 1, x: 5, y: 6 }
  nextKind = 'O'
  score = 420
  lines = 3
  level = 1
  gravAcc = 0
  over = false
  phase = 'playing'
  clearing = null
  particles = []
  silkStreamers = []
  threadFlies = []
  startedAt = performance.now()
  hintEl.classList.remove('hide')
}

function spawn() {
  piece = spawnPiece(nextKind)
  nextKind = bag.next()
  if (collides(board, piece)) {
    over = true
    phase = 'over'
    overAt = performance.now()
    shake = 1
    hintEl.classList.add('hide')
  }
}

function lockPiece() {
  if (!piece) return
  merge(board, piece)
  const rows = fullRows(board)
  piece = null
  if (rows.length) {
    clearing = { rows, t: 0 }
  } else {
    spawn()
  }
}

function finishClear() {
  if (!clearing) return
  const n = clearing.rows.length
  // 粒子（在行位置爆发，用清除前的棋盘色相近似）
  for (const y of clearing.rows) {
    for (let x = 0; x < COLS; x += 2) burst(boardLeft + (x + 0.5) * cell, boardTop + (y + 0.5) * cell, 45 + Math.random() * 30, 6)
    // 丝绸缕：整行横飘
    silkBurst(boardTop + (y + 0.5) * cell, COLS * cell)
  }
  removeRows(board, clearing.rows)
  lines += n
  score += LINE_SCORE[n] * level
  const oldLevel = level
  level = 1 + Math.floor(lines / 10)
  // 抽走的丝飞向计分板
  for (const y of clearing.rows) {
    threadFlies.push({
      x: boardLeft + (COLS * cell) / 2,
      y: boardTop + (y + 0.5) * cell,
      tx: window.innerWidth - 120,
      ty: 60,
      t: 0,
    })
  }
  // 厂志：首次消行 / 升级
  if (lines === n) showChronicle(chronicleEl, FIRST_LINE_TEXT)
  else if (level > oldLevel) showChronicle(chronicleEl, nextEntry())
  clearing = null
  shake = Math.min(1, 0.35 * n)
  spawn()
}

// ---------- 红砖车间背景 ----------
let bgWall: HTMLCanvasElement | null = null

/** 红砖墙：错缝砖纹，边缘实、中心透（露出摄像头里的脸） */
function buildWall(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(2, Math.round(w))
  c.height = Math.max(2, Math.round(h))
  const g = c.getContext('2d')!
  // 砖底
  g.fillStyle = '#6e3122'
  g.fillRect(0, 0, c.width, c.height)
  // 砖块 + 错缝
  const bw = 58
  const rh = 27
  const cols = ['#9e4634', '#94412e', '#a8513d', '#8d3d2b', '#a04a38']
  const rows = Math.ceil(c.height / rh)
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0
    for (let bx = -bw + off; bx < c.width + bw; bx += bw) {
      g.fillStyle = cols[(r * 3 + Math.round(bx / bw)) % cols.length]
      g.fillRect(bx + 1.5, r * rh + 1.5, bw - 3, rh - 3)
      // 砖面暖高光
      g.fillStyle = 'rgba(255, 220, 180, 0.05)'
      g.fillRect(bx + 1.5, r * rh + 1.5, bw - 3, 3)
    }
  }
  // 中心镂空（露出摄像头）：径向渐隐；出帧模式（无摄像头）则整墙铺满
  if (!NOCAM && !FRAME_PLAY) {
    g.globalCompositeOperation = 'destination-in'
    const mg = g.createRadialGradient(
      c.width / 2, c.height / 2, Math.min(w, h) * 0.28,
      c.width / 2, c.height / 2, Math.max(w, h) * 0.72,
    )
    mg.addColorStop(0, 'rgba(0,0,0,0)')
    mg.addColorStop(0.55, 'rgba(0,0,0,0.6)')
    mg.addColorStop(1, 'rgba(0,0,0,0.96)')
    g.fillStyle = mg
    g.fillRect(0, 0, c.width, c.height)
  }
  bgWall = c
}

/** 车间砖拱窗：环绕棋盘的拱形窗框，砖纹 + 拱顶 + 黄铜铭牌 */
function drawMoonGate() {
  const cx = boardLeft + (COLS * cell) / 2
  const cy = boardTop + (ROWS * cell) / 2
  const R = Math.hypot((COLS * cell) / 2 + 42, (ROWS * cell) / 2 + 42)
  const t = 30
  const bw2 = 24
  const bh2 = 12
  // 砖拱环带
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.arc(cx, cy, R - t, 0, Math.PI * 2)
  ctx.clip('evenodd')
  ctx.fillStyle = '#6e3122'
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
  // 拱砖（放射状短砖）
  ctx.fillStyle = '#9e4634'
  const nBricks = Math.ceil((Math.PI * 2 * R) / bw2)
  for (let i = 0; i < nBricks; i++) {
    const a0 = (i / nBricks) * Math.PI * 2
    const a1 = ((i + 0.92) / nBricks) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(cx, cy, R - 1.5, a0, a1)
    ctx.arc(cx, cy, R - t + 1.5, a1, a0, true)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  // 内缘黄铜框线 + 外缘深线
  ctx.strokeStyle = 'rgba(200, 160, 76, 0.7)'
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.arc(cx, cy, R - t, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(46, 22, 14, 0.8)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, R - 2, 0, Math.PI * 2)
  ctx.stroke()
  // 底部黄铜厂铭
  ctx.save()
  ctx.translate(cx, cy + R - t / 2)
  ctx.rotate(-0.015)
  ctx.fillStyle = '#c8a04c'
  roundRectPath(-26, -10, 52, 20, 2)
  ctx.fill()
  ctx.fillStyle = '#3a2416'
  ctx.font = '900 10px "Songti SC","STSong",serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('第一丝厂', 0, 1)
  ctx.restore()
  void bh2
}

function roundRectPath(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 底部剪影：丝厂车间（锯齿厂房 · 烟囱 · 缫丝转轮 · 传动轴）。
 *  深褐实心剪影，压得住摄像头画面。离屏缓存。 */
let skylineCv: HTMLCanvasElement | null = null
let skylineW = 0
let skylineH = 0

function buildSkyline(w: number, h: number) {
  skylineW = w
  skylineH = h
  const c = document.createElement('canvas')
  c.width = Math.max(2, Math.round(w))
  c.height = Math.max(2, Math.round(h))
  const g = c.getContext('2d')!
  const base = h - 86
  const ink = (a = 0.9) => `rgba(26, 14, 10, ${a})`
  g.lineJoin = 'round'
  g.lineCap = 'round'

  // ===== 后排：锯齿厂房天际线（缫丝车间标志屋顶）=====
  const roofY = base - 64
  g.fillStyle = ink(0.62)
  g.beginPath()
  g.moveTo(0, base)
  g.lineTo(0, roofY + 14)
  let x = 0
  let i = 0
  while (x < w) {
    const tooth = 90 + ((i * 37) % 40) // 锯齿宽窄错落
    // 锯齿：垂直面 → 斜面（朝一边倾斜，像锯齿天窗）
    g.lineTo(x + tooth * 0.42, roofY + 14)
    g.lineTo(x + tooth * 0.42, roofY)
    g.lineTo(x + tooth, roofY + 22)
    x += tooth
    i++
  }
  g.lineTo(w, base)
  g.closePath()
  g.fill()
  // 锯齿竖窗（透光的窄缝）
  g.fillStyle = 'rgba(255, 200, 130, 0.16)'
  x = 0
  i = 0
  while (x < w) {
    const tooth = 90 + ((i * 37) % 40)
    g.fillRect(x + tooth * 0.1, roofY + 6, tooth * 0.26, base - roofY - 24)
    x += tooth
    i++
  }

  // ===== 左：大烟囱（红砖厂标志，顶着一缕蒸汽）=====
  g.save()
  g.translate(w * 0.09, base)
  g.fillStyle = ink(0.92)
  // 烟囱身（微收分）
  g.beginPath()
  g.moveTo(-16, 0)
  g.lineTo(-10, -170)
  g.lineTo(10, -170)
  g.lineTo(16, 0)
  g.closePath()
  g.fill()
  // 箍环
  g.fillRect(-13.4, -44, 26.8, 4)
  g.fillRect(-12.4, -92, 24.8, 4)
  g.fillRect(-11.4, -140, 22.8, 4)
  // 顶檐
  g.fillRect(-13, -176, 26, 8)
  // 蒸汽（三团渐淡）
  g.fillStyle = ink(0.3)
  for (const [sx2, sy2, sr] of [
    [-14, -196, 9],
    [2, -208, 12],
    [-8, -224, 15],
  ] as const) {
    g.beginPath()
    g.arc(sx2, sy2, sr, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()

  // ===== 右：缫丝机组剪影（转轮 + 传动轴 + 丝锭架）=====
  g.save()
  g.translate(w * 0.86, base)
  g.fillStyle = ink(0.9)
  // 机身台座
  g.fillRect(-95, -46, 190, 46)
  // 传动主轴（长横轴 + 轴座）
  g.fillRect(-110, -60, 240, 8)
  g.fillRect(-104, -52, 8, 20)
  g.fillRect(88, -52, 8, 20)
  // 两组缫丝转轮（辐条大轮）
  const wheel = (wx: number, wy: number, r: number) => {
    // 轮辋
    g.lineWidth = 5
    g.strokeStyle = ink(0.9)
    g.beginPath()
    g.arc(wx, wy, r, 0, Math.PI * 2)
    g.stroke()
    // 轮毂
    g.fillStyle = ink(0.9)
    g.beginPath()
    g.arc(wx, wy, r * 0.22, 0, Math.PI * 2)
    g.fill()
    // 辐条
    g.lineWidth = 2.6
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      g.beginPath()
      g.moveTo(wx, wy)
      g.lineTo(wx + Math.cos(a) * r, wy + Math.sin(a) * r)
      g.stroke()
    }
    // 皮带（连到主轴）
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(wx, wy - r)
    g.lineTo(wx, -60)
    g.stroke()
  }
  wheel(-52, -18, 22)
  wheel(8, -18, 22)
  wheel(66, -18, 18)
  // 丝锭架（一排小锭子）
  for (let s2 = 0; s2 < 5; s2++) {
    const sx3 = -80 + s2 * 40
    g.fillRect(sx3 - 3, -96, 6, 36) // 锭杆
    g.fillRect(sx3 - 6, -100, 12, 5) // 顶帽
    g.fillRect(sx3 - 7, -84, 14, 14) // 丝卷
  }
  g.restore()

  // ===== 前景：地面横线 + 几笔蒸汽 =====
  g.strokeStyle = ink(0.55)
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(0, base)
  g.lineTo(w, base)
  g.stroke()
  g.strokeStyle = ink(0.22)
  g.lineWidth = 3
  for (const [vx, vy] of [
    [w * 0.3, base - 26],
    [w * 0.42, base - 18],
    [w * 0.55, base - 30],
  ] as const) {
    g.beginPath()
    g.moveTo(vx, vy)
    g.quadraticCurveTo(vx + 10, vy - 12, vx + 4, vy - 24)
    g.stroke()
  }

  skylineCv = c
}

function drawSkyline(w: number, h: number) {
  if (!skylineCv || skylineW !== w || skylineH !== h) buildSkyline(w, h)
  ctx.drawImage(skylineCv!, 0, 0)
}

/** 丝绸飘带：双正弦波动的缎带，随时间流动，端部渐隐。
 *  苏州丝绸意象：桑蚕丝白 + 黛青，叠两层有厚度感。 */
function drawRibbon(
  x0: number,
  y0: number,
  len: number,
  slope: number,
  amp1: number,
  k1: number,
  amp2: number,
  k2: number,
  w0: number,
  w1: number,
  t: number,
  color: string,
) {
  const N = 36
  const grad = ctx.createLinearGradient(x0, 0, x0 + len, 0)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(0.18, color)
  grad.addColorStop(0.82, color)
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.beginPath()
  // 上边缘
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const x = x0 + u * len
    const cy =
      y0 +
      slope * u * len +
      Math.sin(u * k1 + t * 0.7) * amp1 +
      Math.sin(u * k2 - t * 1.1 + 2) * amp2
    const w = (w0 + (w1 - w0) * u) * (0.8 + 0.2 * Math.sin(u * 5 + t * 0.9))
    const y = cy - w / 2
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
  }
  // 下边缘（反向）
  for (let i = N; i >= 0; i--) {
    const u = i / N
    const x = x0 + u * len
    const cy =
      y0 +
      slope * u * len +
      Math.sin(u * k1 + t * 0.7) * amp1 +
      Math.sin(u * k2 - t * 1.1 + 2) * amp2
    const w = (w0 + (w1 - w0) * u) * (0.8 + 0.2 * Math.sin(u * 5 + t * 0.9))
    ctx.lineTo(x, cy + w / 2)
  }
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()
}

/** 两条飘带：左上垂落桑丝白 · 右上黛青回勾 */
function drawSilk(t: number, w: number, h: number) {
  // 远层：黛青（淡）
  drawRibbon(
    w * 0.36, h * 0.16, w * 0.62, 0.10,
    26, 4.2, 12, 7.5,
    30, 14, t,
    'rgba(96, 112, 132, 0.10)',
  )
  // 近层：桑蚕丝白（亮）
  drawRibbon(
    -w * 0.04, h * 0.10, w * 0.6, 0.14,
    32, 3.6, 14, 6.8,
    38, 12, t * 1.15 + 1.7,
    'rgba(240, 234, 219, 0.16)',
  )
  // 丝带高光线（缎面反光的一笔）
  drawRibbon(
    w * 0.05, h * 0.13, w * 0.42, 0.12,
    30, 3.6, 13, 6.8,
    6, 3, t * 1.15 + 1.7,
    'rgba(250, 246, 235, 0.12)',
  )
}

// ---------- 布局 ----------
let cell = 30
let boardLeft = 0
let boardTop = 0

function layout(w: number, h: number) {
  cell = Math.min((w * 0.58) / COLS, (h * 0.52) / ROWS)
  boardLeft = w / 2 - (COLS * cell) / 2
  boardTop = h * 0.1
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  layout(window.innerWidth, window.innerHeight)
  buildWall(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', resize)
resize()

// 初始画面点击 → 开始游戏；收工画面点击 → 跳过等待回初始画面
window.addEventListener('pointerdown', () => {
  if (phase === 'title') {
    reset()
    spawn()
  } else if (phase === 'over') {
    phase = 'title'
    hintEl.classList.remove('hide')
  }
})

// ---------- 绘制 ----------

/** 粉墙窗框：白灰墙环 + 顶部黛瓦檐 + 墨线内缘 */
function drawBrickFrame(x: number, y: number, w: number, h: number, t: number) {
  void t
  // 粉墙底
  ctx.fillStyle = '#e9e2d1'
  ctx.fillRect(x, y, w, h)
  // 墙面微瑕
  ctx.fillStyle = 'rgba(118, 114, 104, 0.06)'
  for (let i = 0; i < 8; i++) {
    ctx.beginPath()
    ctx.ellipse(
      x + 6 + ((i * 53) % Math.max(1, w - 12)),
      y + 8 + ((i * 37) % Math.max(1, h - 16)),
      7 + (i % 3) * 3,
      4 + (i % 2) * 3,
      i,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
  // 顶部黛瓦檐
  ctx.fillStyle = '#3c454f'
  ctx.fillRect(x - 3, y - 6, w + 6, 8)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(x - 3, y - 6, w + 6, 2)
  // 瓦当分格
  ctx.strokeStyle = 'rgba(28, 32, 40, 0.5)'
  ctx.lineWidth = 1
  for (let vx = x; vx <= x + w; vx += 14) {
    ctx.beginPath()
    ctx.moveTo(vx, y - 6)
    ctx.lineTo(vx, y + 2)
    ctx.stroke()
  }
  // 外缘+内缘墨线
  ctx.strokeStyle = 'rgba(50, 54, 66, 0.7)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
}

/** 线轴方块：横置丝锭——两端木轴肩 + 缠丝本体（横纹）+ 丝光 + 铜线收边 */
function drawCell(x: number, y: number, silk: string, alpha = 1) {
  const px = boardLeft + x * cell
  const py = boardTop + y * cell
  const s = cell - 2
  const cy = py + 1 + s / 2
  ctx.save()
  ctx.globalAlpha = alpha
  // 轴肩宽 / 缠丝区长
  const flange = s * 0.17
  const bodyX0 = px + 1 + flange
  const bodyW = s - flange * 2
  // 中轴杆（贯通）
  ctx.fillStyle = '#3a2416'
  ctx.fillRect(px + 1, cy - s * 0.05, s, s * 0.1)
  // 两端木轴肩（梯形）
  for (const sd of [-1, 1]) {
    ctx.beginPath()
    const fx = sd < 0 ? px + 1 : px + 1 + s
    ctx.moveTo(fx, cy - s * 0.36)
    ctx.lineTo(fx + sd * -flange, cy - s * 0.30)
    ctx.lineTo(fx + sd * -flange, cy + s * 0.30)
    ctx.lineTo(fx, cy + s * 0.36)
    ctx.closePath()
    ctx.fillStyle = '#4a2e1c'
    ctx.fill()
    // 轴肩高光
    ctx.fillStyle = 'rgba(255, 220, 170, 0.16)'
    ctx.fillRect(Math.min(fx, fx - sd * flange), cy - s * 0.30, flange, s * 0.09)
  }
  // 缠丝本体（圆角矩形，纵向渐变：上亮下暗的圆柱感）
  const bg = ctx.createLinearGradient(0, cy - s * 0.3, 0, cy + s * 0.3)
  bg.addColorStop(0, 'rgba(255,248,235,0.32)')
  bg.addColorStop(0.35, silk)
  bg.addColorStop(1, 'rgba(30,16,10,0.45)')
  ctx.fillStyle = silk
  ctx.beginPath()
  ctx.moveTo(bodyX0, cy - s * 0.3)
  ctx.lineTo(bodyX0 + bodyW, cy - s * 0.3)
  ctx.lineTo(bodyX0 + bodyW, cy + s * 0.3)
  ctx.lineTo(bodyX0, cy + s * 0.3)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = bg
  ctx.fill()
  // 缠丝横纹（一道道绕线）
  ctx.strokeStyle = 'rgba(20, 10, 6, 0.28)'
  ctx.lineWidth = 1
  const nWind = 5
  for (let k = 1; k < nWind; k++) {
    const wx = bodyX0 + (bodyW / nWind) * k
    ctx.beginPath()
    ctx.moveTo(wx, cy - s * 0.3)
    ctx.lineTo(wx, cy + s * 0.3)
    ctx.stroke()
  }
  // 缎面丝光（斜向亮带）
  const sg = ctx.createLinearGradient(bodyX0, cy - s * 0.3, bodyX0 + bodyW, cy + s * 0.3)
  sg.addColorStop(0.3, 'rgba(255,252,244,0)')
  sg.addColorStop(0.5, 'rgba(255,252,244,0.22)')
  sg.addColorStop(0.7, 'rgba(255,252,244,0)')
  ctx.fillStyle = sg
  ctx.fillRect(bodyX0, cy - s * 0.3, bodyW, s * 0.6)
  // 外缘铜线收边
  ctx.strokeStyle = 'rgba(200, 160, 76, 0.4)'
  ctx.lineWidth = 1
  ctx.strokeRect(px + 1.5, py + 1.5, s - 1, s - 1)
  ctx.restore()
}

function draw(nowSec: number, headX: number, faceValid: boolean) {
  const w = window.innerWidth
  const h = window.innerHeight

  ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0)
  ctx.clearRect(0, 0, w, h)

  // 震屏
  let ox = 0
  let oy = 0
  if (shake > 0.01) {
    ox = (Math.random() - 0.5) * shake * 12
    oy = (Math.random() - 0.5) * shake * 12
    shake *= 0.88
  }
  ctx.translate(ox, oy)

  // 全屏砖墙背景（边缘实、中心透，露出摄像头里的脸）
  if (bgWall) ctx.drawImage(bgWall, 0, 0, w, h)

  // 底部水墨画卷
  drawSkyline(w, h)

  // 丝绸飘带（顶部流动）
  drawSilk(nowSec, w, h)

  // 月洞门（砖砌圆门环绕棋盘）
  drawMoonGate()

  // 棋盘：车间木案暖褐 + 黄铜边
  const bw = COLS * cell
  const bh = ROWS * cell
  ctx.fillStyle = 'rgba(38, 20, 13, 0.62)'
  ctx.fillRect(boardLeft - 4, boardTop - 4, bw + 8, bh + 8)
  ctx.strokeStyle = 'rgba(200, 160, 76, 0.65)'
  ctx.lineWidth = 2
  ctx.strokeRect(boardLeft - 5, boardTop - 5, bw + 10, bh + 10)

  // 网格（暖褐细纹）
  ctx.strokeStyle = 'rgba(240, 228, 205, 0.055)'
  ctx.lineWidth = 1
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath()
    ctx.moveTo(boardLeft + x * cell, boardTop)
    ctx.lineTo(boardLeft + x * cell, boardTop + bh)
    ctx.stroke()
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath()
    ctx.moveTo(boardLeft, boardTop + y * cell)
    ctx.lineTo(boardLeft + bw, boardTop + y * cell)
    ctx.stroke()
  }

  // 已固定方块（消行时按抽丝进度逐格淡出）
  const sweepP = clearing ? Math.min(1, clearing.t / 0.32) : 0
  for (let y = 0; y < ROWS; y++) {
    const inClear = clearing ? clearing.rows.includes(y) : false
    for (let x = 0; x < COLS; x++) {
      const c = board[y][x]
      if (c === null) continue
      if (inClear) {
        // 抽丝从左往右：某格左侧已被抽走则隐藏，正在抽的格渐隐
        const taken = clamp(sweepP * (COLS + 2) - x, 0, 1)
        if (taken < 1) drawCell(x, y, PIECE_COLORS[KINDS[c - 1]], 1 - taken)
      } else {
        drawCell(x, y, PIECE_COLORS[KINDS[c - 1]])
      }
    }
  }

  // 抽丝：整行被抽成一根波动的丝线，从左向右抽出
  if (clearing) {
    const p = Math.min(1, clearing.t / 0.32)
    for (const y of clearing.rows) {
      const ly = boardTop + (y + 0.5) * cell
      const lxEnd = boardLeft + bw * p
      ctx.save()
      // 丝线（贝塞尔波）
      ctx.strokeStyle = 'rgba(245, 239, 226, 0.9)'
      ctx.lineWidth = 2
      ctx.shadowColor = 'rgba(245, 239, 226, 0.5)'
      ctx.shadowBlur = 6
      ctx.beginPath()
      const N2 = 14
      for (let i = 0; i <= N2; i++) {
        const u = i / N2
        const lx = boardLeft + (lxEnd - boardLeft) * u
        const wob = Math.sin(u * 14 + clearing.t * 30) * 3.2 * (1 - p * 0.5)
        i ? ctx.lineTo(lx, ly + wob) : ctx.moveTo(lx, ly + wob)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
      // 抽丝针头（黄铜亮点）
      ctx.fillStyle = '#ffd98a'
      ctx.beginPath()
      ctx.arc(lxEnd, ly, 3.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  // 活动块 + 幽灵（虚线空心）+ 吊丝（缫丝机放线）
  if (piece) {
    const color = PIECE_COLORS[piece.kind]
    const gy = dropY(board, piece)
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = 'rgba(240, 230, 210, 0.55)'
    ctx.lineWidth = 1.6
    for (const [cx, cy] of pieceCells({ ...piece, y: gy })) {
      if (cy < 0) continue
      ctx.strokeRect(
        boardLeft + cx * cell + 2.5,
        boardTop + cy * cell + 2.5,
        cell - 5,
        cell - 5,
      )
    }
    ctx.restore()
    // 吊丝：从棋盘顶到活动块的波动丝线
    const cells2 = pieceCells(piece)
    const topCell = cells2.reduce((m, c) => Math.min(m, c[1]), 0)
    const hx =
      boardLeft +
      (cells2.reduce((s2, c) => s2 + c[0], 0) / cells2.length + 0.5) * cell
    const hy = boardTop + Math.max(topCell, -1) * cell
    if (hy > boardTop + 4) {
      ctx.save()
      ctx.strokeStyle = 'rgba(245, 239, 226, 0.4)'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      const N3 = 8
      for (let i = 0; i <= N3; i++) {
        const u = i / N3
        const yy = boardTop - 2 + (hy - boardTop + 2) * u
        const xx = hx + Math.sin(u * 6 + nowSec * 3) * 2.6
        i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy)
      }
      ctx.stroke()
      ctx.restore()
    }
    for (const [cx, cy] of pieceCells(piece)) {
      if (cy >= 0) drawCell(cx, cy, color)
    }
  }

  // 头部位指示（棋盘上方小箭头，跟随头 x）
  if (faceValid) {
    const col = headCol(headX)
    const mx = boardLeft + (col + pieceHalfW()) * cell
    const my = boardTop - 16
    ctx.fillStyle = 'rgba(125,255,158,0.9)'
    ctx.beginPath()
    ctx.moveTo(mx, my)
    ctx.lineTo(mx - 7, my - 9)
    ctx.lineTo(mx + 7, my - 9)
    ctx.closePath()
    ctx.fill()
  } else if (piece && !FRAME_PLAY) {
    ctx.fillStyle = 'rgba(255,180,90,0.9)'
    ctx.font = '700 13px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('看不到脸！', boardLeft + bw / 2, boardTop - 14)
  }

  // 下一块预览（右上）
  const pvW = cell * 3.4
  const pvX = boardLeft + bw + 18
  const pvY = boardTop
  drawBrickFrame(pvX, pvY, pvW, pvW + 26, 12)
  ctx.fillStyle = 'rgba(28, 16, 11, 0.6)'
  ctx.fillRect(pvX + 12, pvY + 12, pvW - 24, pvW + 2)
  ctx.strokeStyle = 'rgba(50, 54, 66, 0.55)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(pvX + 12.5, pvY + 12.5, pvW - 25, pvW + 1)
  ctx.fillStyle = 'rgba(240, 230, 210, 0.75)'
  ctx.font = '700 12px "Songti SC", "STSong", serif'
  ctx.textAlign = 'center'
  ctx.fillText('茧 笼', pvX + pvW / 2, pvY + 30)
  const pcells = pieceCells({ kind: nextKind, rot: 0, x: 0, y: 0 })
  const minX = Math.min(...pcells.map((c) => c[0]))
  const maxX = Math.max(...pcells.map((c) => c[0]))
  const minY = Math.min(...pcells.map((c) => c[1]))
  const maxY = Math.max(...pcells.map((c) => c[1]))
  const pc = cell * 0.62
  const offX = pvX + pvW / 2 - ((maxX - minX + 1) * pc) / 2
  const offY = pvY + pvW / 2 + 6 - ((maxY - minY + 1) * pc) / 2
  for (const [cx, cy] of pcells) {
    const color = PIECE_COLORS[nextKind]
     ctx.beginPath()
     ctx.rect(offX + (cx - minX) * pc + 1, offY + (cy - minY) * pc + 1, pc - 2, pc - 2)
     ctx.fillStyle = color
     ctx.shadowColor = color
     ctx.shadowBlur = 8
     ctx.fill()
     ctx.shadowBlur = 0
   }

  // 粒子
  particles = particles.filter((p) => {
    p.life += 1 / 60
    if (p.life > p.max) return false
    p.vy += 620 / 60
    p.x += p.vx / 60
    p.y += p.vy / 60
    const k = 1 - p.life / p.max
    const sz = Math.ceil(p.size * k * 2)
    ctx.fillStyle = `hsla(${p.hue}, 95%, 62%, ${k})`
    ctx.fillRect(Math.round(p.x - sz / 2), Math.round(p.y - sz / 2), sz, sz)
    return true
  })

  // 丝缕（消行的丝绸飘带碎片）
  silkStreamers = silkStreamers.filter((s) => {
    s.life += 1 / 60
    if (s.life > s.max) return false
    s.x += s.vx / 60
    const k = Math.sin((s.life / s.max) * Math.PI)
    ctx.strokeStyle = `rgba(240, 234, 219, ${(s.alpha * k).toFixed(3)})`
    ctx.lineWidth = 2.6 * k + 0.6
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = 0; i <= 6; i++) {
      const u = i / 6
      const lx = s.x - (s.vx / Math.abs(s.vx)) * s.len * k * u
      const ly = s.y + Math.sin(u * 4 + s.life * 6 + s.wob) * 5 * k
      i ? ctx.lineTo(lx, ly) : ctx.moveTo(lx, ly)
    }
    ctx.stroke()
    return true
  })

  // 抽走的丝：飞向计分板（贝塞尔轨迹 + 拖尾）
  threadFlies = threadFlies.filter((f) => {
    f.t += 1 / 60 / 0.55
    if (f.t >= 1) return false
    const k = f.t
    const ex = k * k
    const fx = f.x + (f.tx - f.x) * ex
    const fy = f.y + (f.ty - f.y) * ex - Math.sin(k * Math.PI) * 60
    ctx.save()
    ctx.strokeStyle = 'rgba(245, 239, 226, 0.85)'
    ctx.lineWidth = 1.8
    ctx.shadowColor = 'rgba(245, 239, 226, 0.5)'
    ctx.shadowBlur = 5
    ctx.beginPath()
    for (let i = 0; i <= 6; i++) {
      const u = i / 6
      const px2 = fx - (f.tx - f.x) * 0.12 * u
      const py2 = fy - Math.sin((k - u * 0.08) * Math.PI) * 2 + Math.sin(u * 5 + f.t * 18) * 3.4 * u
      i ? ctx.lineTo(px2, py2) : ctx.moveTo(px2, py2)
    }
    ctx.stroke()
    ctx.restore()
    return true
  })

  // HUD（DOM · 账房铅字）
  hudEl.innerHTML = over
    ? `<span class="big">今日收工</span>`
    : phase === 'title'
      ? '待开工'
      : `出丝 <b>${score}</b> 两 &nbsp; 抽丝 <b>${lines}</b> 根 &nbsp; 转速 <b>${level}</b> 档`

  // 结束画面（收工）
  if (over) {
    ctx.fillStyle = 'rgba(24, 12, 8, 0.66)'
    ctx.fillRect(-20, -20, w + 40, h + 40)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#e8b06a'
    ctx.font = `900 ${Math.min(w * 0.08, 58)}px "Songti SC", "PingFang SC", serif`
    ctx.fillText('今 日 收 工', w / 2, h * 0.4)
    ctx.fillStyle = 'rgba(240, 228, 205, 0.88)'
    ctx.font = `700 ${Math.min(w * 0.03, 20)}px "Songti SC", "PingFang SC", serif`
    ctx.fillText(`本班出丝 ${score} 两 · 抽丝 ${lines} 根`, w / 2, h * 0.4 + Math.min(w * 0.06, 46))
    // 倒计时回初始画面 + 点击可跳过
    const remain = Math.max(0, Math.ceil((5000 - (performance.now() - overAt)) / 1000))
    const br = 0.55 + 0.45 * Math.sin(performance.now() / 300)
    ctx.fillStyle = `rgba(240, 228, 205, ${br.toFixed(3)})`
    ctx.font = `700 ${Math.min(w * 0.026, 18)}px "Songti SC", "PingFang SC", serif`
    ctx.fillText(`点击跳过 · ${remain} 秒后回到戏台`, w / 2, h * 0.58)
  }

  // 初始画面
  if (phase === 'title') {
    ctx.fillStyle = 'rgba(24, 12, 8, 0.58)'
    ctx.fillRect(-20, -20, w + 40, h + 40)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // 厂名
    ctx.fillStyle = '#e8b06a'
    ctx.font = `900 ${Math.min(w * 0.045, 30)}px "Songti SC", "PingFang SC", serif`
    ctx.fillText('苏州第一丝厂 · 缫丝车间', w / 2, h * 0.3)
    // 主标题
    ctx.fillStyle = 'rgba(240, 228, 205, 0.95)'
    ctx.font = `900 ${Math.min(w * 0.11, 82)}px "Songti SC", "PingFang SC", serif`
    ctx.fillText('抽 丝 方 块', w / 2, h * 0.42)
    // 呼吸的「点击开始」
    const tb = 0.5 + 0.5 * Math.sin(performance.now() / 320)
    ctx.fillStyle = `rgba(232, 176, 106, ${(0.45 + 0.55 * tb).toFixed(3)})`
    ctx.font = `700 ${Math.min(w * 0.036, 26)}px "Songti SC", "PingFang SC", serif`
    ctx.fillText('—— 点 击 开 始 ——', w / 2, h * 0.56)
    // 操作速览
    ctx.fillStyle = 'rgba(240, 228, 205, 0.6)'
    ctx.font = `700 ${Math.min(w * 0.02, 14)}px "Songti SC", "PingFang SC", serif`
    ctx.fillText('移头左右 · 歪头旋转 · 点头加速 · 张嘴砸落', w / 2, h * 0.66)
  }

  // 调试
  if (DEBUG) {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = 'rgba(125,255,158,0.85)'
    ctx.font = '12px monospace'
    ctx.fillText(`headX=${headX.toFixed(0)} col=${headCol(headX)}`, 12, 60)
  }
}

// 头 x → 目标 piece.x（以实际占用中心对齐，覆盖所有形状/旋转态：I/J/L/S/Z/T/O）
function headCol(headX: number): number {
  const headCell = Math.round((headX - boardLeft) / cell - 0.5)
  if (!piece) return clamp(headCell, 0, COLS - 1)
  const b = pieceBounds(piece)
  const centerOffset = (b.minX + b.maxX) / 2 - piece.x // 占用中心相对 piece.x 的偏移
  return clamp(Math.round(headCell - centerOffset), -2, COLS + 1)
}
/** 箭头指示用：方块占用中心（含半格），相对 piece.x。
 *  横 I 在 0 列 → 2.0（4 格中心）；竖 I → 1.5（单格中心，piece.x=-1 时箭头对准第 0 列中心） */
function pieceHalfW(): number {
  if (!piece) return 1
  const b = pieceBounds(piece)
  return (b.minX + b.maxX) / 2 - piece.x + 0.5
}

/** 把 piece 移到期望 piece.x（受阻则找最近可用列）。
 *  边界按「实际占用列相对 piece.x 的偏移」计算：竖 I 占矩阵第 1 列（偏移+1），
 *  贴第 0 列需要 piece.x = -1；贴第 10 列需要 piece.x = 9。 */
function moveTowardCol(desired: number) {
  if (!piece) return
  const b = pieceBounds(piece)
  const offMin = b.minX - piece.x
  const offMax = b.maxX - piece.x
  const minX = -offMin
  const maxX = COLS - 1 - offMax
  const target = Math.max(minX, Math.min(maxX, desired))
  if (!collides(board, piece, target, piece.y)) {
    piece.x = target
    return
  }
  for (let d = 1; d <= 3; d++) {
    for (const t of [target - d, target + d]) {
      if (t >= minX && t <= maxX && !collides(board, piece, t, piece.y)) {
        piece.x = t
        return
      }
    }
  }
}

// ---------- 主循环 ----------
let lastT = performance.now()

async function main() {
  const setBoot = (t: string, err = false) => {
    bootEl.textContent = t
    bootEl.classList.toggle('err', err)
  }
  setBoot(NOCAM || FRAME_PLAY ? '正在布置戏台…' : '正在唤醒摄像头…')
  let face: Awaited<ReturnType<typeof createFace>> | null = null
  if (!NOCAM && !FRAME_PLAY) {
    try {
      await openCamera(video)
    } catch {
      setBoot('无法访问摄像头，请检查权限后刷新', true)
      return
    }
    setBoot('正在装载方块…')
    try {
      face = await createFace()
    } catch (e) {
      console.error(e)
      setBoot('模型加载失败，请检查网络后刷新', true)
      return
    }
  }
  bootEl.classList.add('hide')
  // 布景模式直接摆好一局；否则停在初始画面，点击后开始
  if (FRAME_PLAY) {
    setupFramePlay()
  } else {
    reset()
    phase = 'title'
    piece = null
  }

  const loop = () => {
    const now = performance.now()
    const dt = Math.min((now - lastT) / 1000, 0.1)
    lastT = now

    let headX = window.innerWidth / 2
    let faceValid = false

    if (!NOCAM && !FRAME_PLAY && face && video.readyState >= 2) {
      try {
        const result = face.detectForVideo(video, now)
        const { frame, events } = input.update(result, makeMapper(video.videoWidth, video.videoHeight, window.innerWidth, window.innerHeight), now, dt * 1000)
        headX = frame.x
        faceValid = frame.valid

        if (phase === 'playing' && !clearing) {
          // 移动（头 x 驱动）
          if (faceValid && piece) moveTowardCol(headCol(frame.x))
          // 旋转
          if (events.rotate !== 0 && piece) tryRotate(board, piece, events.rotate)
          // 点头软降
          if (events.softDrop && piece) {
            if (!collides(board, piece, piece.x, piece.y + 1)) piece.y++
            else lockPiece()
          }
          // 张嘴硬降
          if (events.hardDrop && piece) {
            piece.y = dropY(board, piece)
            shake = Math.max(shake, 0.5)
            const cy = piece.y + 1
            const color = PIECE_COLORS[piece.kind]
            void color
            for (const [cx] of pieceCells(piece)) {
              burst(boardLeft + (cx + 0.5) * cell, boardTop + cy * cell, 40 + Math.random() * 20, 5)
            }
            lockPiece()
          }
        }
        // 收工后重开改为点击画面（见下方 pointerdown 监听）
      } catch {
        /* 偶发帧错误 */
      }
    }

    // 重力
    // 重力（布景模式冻结，只渲染）
    if (phase === 'playing' && !clearing && piece && !FRAME_PLAY) {
      gravAcc += dt * 1000
      const g = gravityMs(level)
      while (gravAcc > g) {
        gravAcc -= g
        if (!collides(board, piece, piece.x, piece.y + 1)) piece.y++
        else {
          lockPiece()
          break
        }
      }
    } else {
      gravAcc = 0
    }

    // 消行动画推进
    if (clearing) {
      clearing.t += dt
      if (clearing.t > 0.32) finishClear()
    }

    // 收工画面停留 5 秒后自动回到初始画面
    if (phase === 'over' && now - overAt > 5000) {
      phase = 'title'
      piece = null
      hintEl.classList.remove('hide')
    }

    draw(now / 1000, headX, faceValid)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  // 提示常驻（游戏结束画面才淡出，开局时恢复）
  hintEl.classList.remove('hide')
  void hudEl
  void startedAt
}

main()
