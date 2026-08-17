/** 厂志系统：丝厂编年与缫丝工艺条目，升级/首消时浮现。 */

export interface ChronicleEntry {
  year: string
  text: string
}

export const CHRONICLE: ChronicleEntry[] = [
  { year: '厂志', text: '姑苏城南，丝厂临河而立，缫丝车昼夜不歇。' },
  { year: '厂志', text: '建厂之初，缫丝产能占苏州半壁江山，白厂丝远销海外。' },
  { year: '工艺', text: '一茧之丝，可长千米；数茧并抽，方成一缕白厂丝。' },
  { year: '工艺', text: '缫丝之道，全在指尖——索绪、理绪、添绪，缺一不可。' },
  { year: '厂志', text: '蚕丝教育家费达生曾主厂务，倡科学缫丝，泽被桑梓。' },
  { year: '厂志', text: '百年红砖厂房焕新，文化产业园区开园——旧车间，新丝路。' },
]

export const FIRST_LINE_TEXT: ChronicleEntry = {
  year: '出丝',
  text: '一缕白厂丝离鞘，直如弦，白如雪。',
}

/** 顺序取下一条厂志（循环） */
let idx = 0
export function nextEntry(): ChronicleEntry {
  const e = CHRONICLE[idx % CHRONICLE.length]
  idx++
  return e
}

/** DOM 展示：浮现 3.2s 后淡出 */
export function showChronicle(el: HTMLElement, entry: ChronicleEntry) {
  el.innerHTML = `<span class="year">◆ ${entry.year} ◆</span>${entry.text}`
  el.classList.add('show')
  clearTimeout(showChronicle._t)
  showChronicle._t = window.setTimeout(() => el.classList.remove('show'), 3200)
}
showChronicle._t = 0
