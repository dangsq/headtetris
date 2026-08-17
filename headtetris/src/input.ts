import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'

/**
 * 头部控制器：
 * · 头 x（屏幕像素，平滑）→ 方块目标列
 * · 歪头 roll 越阈（±13°，滞回 7°）→ 旋转事件
 * · 点头（鼻尖下落速度）→ 软降事件
 * · 张嘴 jawOpen 持续 140ms → 硬降事件（一次）
 * · 挑眉 browInnerUp → 结束画面长按进度（main 决定是否重开）
 */

const ROLL_ON = 0.23 // ≈13°
const ROLL_OFF = 0.12 // ≈7°
const ROTATE_CD = 320
const NOD_VY = 0.5 // px/ms
const NOD_CD = 240
const JAW_ON = 0.45
const JAW_OFF = 0.22
const JAW_HOLD = 140

export interface HeadFrame {
  valid: boolean
  x: number
  y: number
  roll: number
  jaw: number
}

export interface InputEvents {
  rotate: -1 | 0 | 1
  softDrop: boolean
  hardDrop: boolean
}

export class HeadInput {
  private sx = -1
  private sy = -1
  private vy = 0
  private arm = 0 // roll 武装态：-1 已左 / 0 空闲 / 1 已右
  private lastRotAt = 0
  private lastNodAt = 0
  private jawSince = 0
  private jawFired = false

  update(
    result: FaceLandmarkerResult,
    map: (nx: number, ny: number) => [number, number],
    nowMs: number,
    dtMs: number,
  ): { frame: HeadFrame; events: InputEvents } {
    const lm = result.faceLandmarks?.[0]
    const shapes = result.faceBlendshapes?.[0]?.categories
    let jaw = 0
    if (shapes) {
      for (const c of shapes) {
        if (c.categoryName === 'jawOpen') jaw = c.score
      }
    }
    if (!lm || lm.length < 460) {
      return { frame: { valid: false, x: this.sx, y: this.sy, roll: 0, jaw }, events: { rotate: 0, softDrop: false, hardDrop: false } }
    }

    const [nx, ny] = map(lm[1].x, lm[1].y)
    if (this.sx < 0) {
      this.sx = nx
      this.sy = ny
    } else {
      const k = 1 - Math.exp(-dtMs / 60)
      this.sx += (nx - this.sx) * k
      this.sy += (ny - this.sy) * k
    }
    // 垂直速度（px/ms），EMA 平滑
    const instVy = dtMs > 0 ? (ny - this.sy) / Math.max(dtMs, 1) : 0
    this.vy = this.vy * 0.7 + instVy * 0.3

    // roll：外眼角连线（landmark 空间，未镜像）——subject 右倾为负
    const roll = Math.atan2(lm[263].y - lm[33].y, lm[263].x - lm[33].x)

    // ---- 旋转事件 ----
    let rotate: -1 | 0 | 1 = 0
    if (this.arm === 0) {
      if (roll < -ROLL_ON && nowMs - this.lastRotAt > ROTATE_CD) {
        rotate = -1
        this.arm = -1
        this.lastRotAt = nowMs
      } else if (roll > ROLL_ON && nowMs - this.lastRotAt > ROTATE_CD) {
        rotate = 1
        this.arm = 1
        this.lastRotAt = nowMs
      }
    } else if (this.arm === -1 && roll > -ROLL_OFF) this.arm = 0
    else if (this.arm === 1 && roll < ROLL_OFF) this.arm = 0

    // ---- 点头软降 ----
    let softDrop = false
    if (this.vy > NOD_VY && nowMs - this.lastNodAt > NOD_CD && this.arm === 0) {
      softDrop = true
      this.lastNodAt = nowMs
    }

    // ---- 张嘴硬降 ----
    let hardDrop = false
    if (jaw > JAW_ON) {
      if (this.jawSince === 0) this.jawSince = nowMs
      else if (!this.jawFired && nowMs - this.jawSince > JAW_HOLD) {
        hardDrop = true
        this.jawFired = true
      }
    } else if (jaw < JAW_OFF) {
      this.jawSince = 0
      this.jawFired = false
    }

    return { frame: { valid: true, x: this.sx, y: this.sy, roll, jaw }, events: { rotate, softDrop, hardDrop } }
  }
}
