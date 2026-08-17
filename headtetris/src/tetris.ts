/** 纯俄罗斯方块逻辑：与渲染、输入完全解耦。 */

export const COLS = 11
export const ROWS = 15

export const KINDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const
export type Kind = (typeof KINDS)[number]

/** 苏绣丝线七色：白厂丝 / 湖蓝 / 黛青 / 绛红 / 鹅黄 / 紫酱 / 葱绿 */
export const PIECE_COLORS: Record<Kind, string> = {
  I: '#e9e2d0', // 白厂丝
  O: '#5b8a9a', // 湖蓝
  T: '#46606e', // 黛青
  S: '#9e3b3b', // 绛红
  Z: '#c9a03c', // 鹅黄
  J: '#6e4458', // 紫酱
  L: '#7a9058', // 葱绿
}

export interface Piece {
  kind: Kind
  rot: number // 0-3
  x: number // 矩阵左上角所在列
  y: number // 所在行
}

/** 基础形状矩阵（# = 方块） */
const BASE: Record<Kind, string[]> = {
  I: ['....', '####', '....', '....'],
  O: ['##', '##'],
  T: ['.#.', '###', '...'],
  S: ['.##', '##.', '...'],
  Z: ['##.', '.##', '...'],
  J: ['#..', '###', '...'],
  L: ['..#', '###', '...'],
}

function parse(rows: string[]): number[][] {
  return rows.map((r) => [...r].map((c) => (c === '#' ? 1 : 0)))
}

/** 矩阵顺时针旋转 90° */
function rotCW(m: number[][]): number[][] {
  const n = m.length
  const out = m.map((_, i) => m.map((row) => row[n - 1 - i]))
  return out
}

/** 每种块的 4 个旋转态 */
const ROTATIONS: Record<Kind, number[][][]> = Object.fromEntries(
  KINDS.map((k) => {
    const r0 = parse(BASE[k])
    const r1 = rotCW(r0)
    const r2 = rotCW(r1)
    const r3 = rotCW(r2)
    return [k, [r0, r1, r2, r3]]
  }),
) as Record<Kind, number[][][]>

export type Board = (number | null)[][] // null 或 kind 序号+1

export function newBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<number | null>(COLS).fill(null))
}

export function pieceMatrix(p: Piece): number[][] {
  return ROTATIONS[p.kind][p.rot & 3]
}

/** 方块占据的格子（棋盘坐标） */
export function pieceCells(p: Piece): [number, number][] {
  const m = pieceMatrix(p)
  const cells: [number, number][] = []
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m[y].length; x++) if (m[y][x]) cells.push([p.x + x, p.y + y])
  return cells
}

export function pieceWidth(p: Piece): number {
  const m = pieceMatrix(p)
  return m[0].length
}

/** 方块实际占用的列范围（竖 I = 1 列，而非矩阵宽 4） */
export function pieceBounds(p: Piece): { minX: number; maxX: number } {
  const cells = pieceCells(p)
  let minX = Infinity
  let maxX = -Infinity
  for (const [cx] of cells) {
    if (cx < minX) minX = cx
    if (cx > maxX) maxX = cx
  }
  return { minX, maxX }
}

export function collides(board: Board, p: Piece, px = p.x, py = p.y): boolean {
  for (const [cx, cy] of pieceCells({ ...p, x: px, y: py })) {
    if (cx < 0 || cx >= COLS || cy >= ROWS) return true
    if (cy >= 0 && board[cy][cx] !== null) return true
  }
  return false
}

/** 尝试旋转（带简易踢墙）；成功返回 true 并修改 p */
export function tryRotate(board: Board, p: Piece, dir: 1 | -1): boolean {
  const np: Piece = { ...p, rot: (p.rot + (dir === 1 ? 1 : 3)) & 3 }
  for (const kick of [0, -1, 1, -2, 2]) {
    if (!collides(board, np, p.x + kick, p.y)) {
      p.rot = np.rot
      p.x += kick
      return true
    }
  }
  return false
}

/** 7-bag 随机 */
export class Bag {
  private queue: Kind[] = []
  next(): Kind {
    if (this.queue.length === 0) {
      this.queue = [...KINDS]
      for (let i = this.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]]
      }
    }
    return this.queue.pop()!
  }
}

export function spawnPiece(kind: Kind): Piece {
  const m = ROTATIONS[kind][0]
  return { kind, rot: 0, x: Math.floor((COLS - m[0].length) / 2), y: -1 }
}

/** 固定方块进棋盘 */
export function merge(board: Board, p: Piece) {
  const idx = KINDS.indexOf(p.kind) + 1
  for (const [cx, cy] of pieceCells(p)) {
    if (cy >= 0) board[cy][cx] = idx
  }
}

/** 找出已满的行号 */
export function fullRows(board: Board): number[] {
  const rows: number[] = []
  for (let y = 0; y < ROWS; y++) if (board[y].every((c) => c !== null)) rows.push(y)
  return rows
}

/** 移除指定行（顶部补空行） */
export function removeRows(board: Board, rows: number[]) {
  for (const y of rows) {
    board.splice(y, 1)
    board.unshift(Array<number | null>(COLS).fill(null))
  }
}

/** 掉落到底部（返回落点 y），不合并 */
export function dropY(board: Board, p: Piece): number {
  let y = p.y
  while (!collides(board, p, p.x, y + 1)) y++
  return y
}

export const LINE_SCORE = [0, 100, 300, 500, 800]

export function gravityMs(level: number): number {
  return Math.max(90, 850 * Math.pow(0.82, level - 1))
}
