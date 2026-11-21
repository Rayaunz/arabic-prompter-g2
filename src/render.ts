// Arabic text -> pixels.
//
// The G2 firmware font has no Arabic glyphs, so the script is drawn on a
// phone-side canvas (the WebView does the shaping + bidi) and pushed to the
// glasses as images. The 576x288 display is covered by four 288x144 image
// containers, the largest size the platform allows.

export const SCREEN_W = 576
export const SCREEN_H = 288
export const TILE_W = 288
export const TILE_H = 144

export const FONT_FAMILY = '"Noto Sans Arabic", "Geeza Pro", "Noto Naskh Arabic", system-ui, sans-serif'

export interface LayoutOptions {
  /** Lines per 144px band: 1 = huge, 2 = large, 3 = medium. */
  linesPerBand: number
  /** Use only the top half of the display (2 images instead of 4, twice as fast). */
  halfScreen: boolean
  bold: boolean
}

export interface Layout {
  lines: string[]
  linesPerPage: number
  lineHeight: number
  fontSize: number
  font: string
}

const PAD_X = 6

const measureCanvas = document.createElement('canvas')
const measureCtx = measureCanvas.getContext('2d')!

export function layoutText(text: string, opts: LayoutOptions): Layout {
  const lineHeight = TILE_H / opts.linesPerBand
  const fontSize = Math.floor(lineHeight / 1.7)
  const font = `${opts.bold ? 700 : 500} ${fontSize}px ${FONT_FAMILY}`
  const maxWidth = SCREEN_W - PAD_X * 2
  measureCtx.font = font
  measureCtx.direction = 'rtl'

  const lines: string[] = []
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n')
  let lastBlank = true
  for (const raw of paragraphs) {
    const words = raw.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      // One blank line between paragraphs, never at the very top.
      if (!lastBlank) lines.push('')
      lastBlank = true
      continue
    }
    lastBlank = false
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (measureCtx.measureText(candidate).width <= maxWidth) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      // A single word wider than the screen: hard-split it.
      let rest = word
      while (measureCtx.measureText(rest).width > maxWidth && rest.length > 1) {
        let cut = rest.length - 1
        while (cut > 1 && measureCtx.measureText(rest.slice(0, cut)).width > maxWidth) cut--
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      current = rest
    }
    if (current) lines.push(current)
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop()

  const linesPerPage = opts.linesPerBand * (opts.halfScreen ? 1 : 2)
  return { lines, linesPerPage, lineHeight, fontSize, font }
}

export function pageCount(layout: Layout): number {
  return Math.max(1, Math.ceil(layout.lines.length / layout.linesPerPage))
}

/** Draws one page (white on black; black = pixel off on the glasses). */
export function drawPage(canvas: HTMLCanvasElement, layout: Layout, page: number, hint?: string): void {
  canvas.width = SCREEN_W
  canvas.height = SCREEN_H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H)
  ctx.fillStyle = '#fff'
  ctx.font = layout.font
  ctx.direction = 'rtl'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'

  const start = page * layout.linesPerPage
  const shown = hint !== undefined ? [hint] : layout.lines.slice(start, start + layout.linesPerPage)
  shown.forEach((line, i) => {
    if (!line) return
    const baseline = i * layout.lineHeight + layout.lineHeight * 0.7
    ctx.fillText(line, SCREEN_W - PAD_X, baseline)
  })

  // Progress bar along the bottom edge of the used area (fills right-to-left).
  if (hint === undefined) {
    const total = pageCount(layout)
    if (total > 1) {
      const usedH = layout.linesPerPage * layout.lineHeight
      const w = Math.round((SCREEN_W * (page + 1)) / total)
      ctx.fillStyle = '#666'
      ctx.fillRect(SCREEN_W - w, usedH - 3, w, 3)
    }
  }
}

export interface Tile {
  /** 0 = top-right, 1 = top-left, 2 = bottom-right, 3 = bottom-left (Arabic reading order). */
  index: number
  x: number
  y: number
}

export const TILES: Tile[] = [
  { index: 0, x: TILE_W, y: 0 },
  { index: 1, x: 0, y: 0 },
  { index: 2, x: TILE_W, y: TILE_H },
  { index: 3, x: 0, y: TILE_H },
]

const tileCanvas = document.createElement('canvas')
tileCanvas.width = TILE_W
tileCanvas.height = TILE_H

/** Cuts one 288x144 tile out of the page canvas and returns it as PNG bytes plus a change key. */
export async function tilePng(page: HTMLCanvasElement, tile: Tile): Promise<{ bytes: Uint8Array; key: string }> {
  const ctx = tileCanvas.getContext('2d')!
  ctx.drawImage(page, tile.x, tile.y, TILE_W, TILE_H, 0, 0, TILE_W, TILE_H)
  const blob: Blob = await new Promise((resolve, reject) => {
    tileCanvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // Cheap content key: length + FNV-1a over the PNG bytes.
  let h = 2166136261
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 16777619)
  }
  return { bytes, key: `${bytes.length}:${h >>> 0}` }
}
