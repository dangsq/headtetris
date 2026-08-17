import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision'

// BASE_URL：dev 下为 '/'，GitHub Pages 构建后为 '/headtetris/'
const B = import.meta.env.BASE_URL
const WASM_BASE = `${B}mediapipe/wasm`
const FACE_MODEL = `${B}mediapipe/models/face_landmarker.task`

export async function createFace(): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
  const face = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
  })
  return face
}

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  })
  video.srcObject = stream
  await video.play()
  return stream
}

/** normalized(0-1, 左上原点) → 全屏 cover + 镜像后的屏幕像素坐标 */
export function makeMapper(
  vw: number,
  vh: number,
  cw: number,
  ch: number,
): (nx: number, ny: number) => [number, number] {
  const scale = Math.max(cw / vw, ch / vh)
  const dw = vw * scale
  const dh = vh * scale
  const ox = (cw - dw) / 2
  const oy = (ch - dh) / 2
  return (nx, ny) => [ox + (1 - nx) * dw, oy + ny * dh]
}
