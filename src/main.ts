import '@fontsource/noto-sans-arabic/arabic-500.css'
import '@fontsource/noto-sans-arabic/arabic-700.css'
import './style.css'
import { Glasses, type Gesture } from './glasses'
import { drawPage, layoutText, pageCount, FONT_FAMILY, type Layout } from './render'

interface Settings {
  linesPerBand: number
  halfScreen: boolean
  bold: boolean
  wpm: number
}

const DEFAULTS: Settings = { linesPerBand: 2, halfScreen: false, bold: true, wpm: 110 }
const HINT = 'اكتب النص في تطبيق الجوال'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const els = {
  status: $('status'),
  preview: $<HTMLCanvasElement>('preview'),
  counter: $('counter'),
  prev: $<HTMLButtonElement>('prev'),
  next: $<HTMLButtonElement>('next'),
  play: $<HTMLButtonElement>('play'),
  restart: $<HTMLButtonElement>('restart'),
  script: $<HTMLTextAreaElement>('script'),
  paste: $<HTMLButtonElement>('paste'),
  clear: $<HTMLButtonElement>('clear'),
  size: $('size'),
  area: $('area'),
  bold: $<HTMLInputElement>('bold'),
  wpm: $<HTMLInputElement>('wpm'),
  wpmVal: $('wpmVal'),
}

let glasses: Glasses | null = null
let settings: Settings = { ...DEFAULTS }
let script = ''
let layout: Layout
/** Position is kept as a line index so it survives font-size changes. */
let line = 0
let playing = false
let timer: number | undefined
let heartbeat: number | undefined

const pageCanvas = document.createElement('canvas')
const arabicDigits = (n: number) => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)])

// ── storage ──────────────────────────────────────────────────────────
// Browser localStorage is wiped inside the Even app, so the bridge store is
// the real one; localStorage only covers previewing in a plain browser.
async function load(key: string): Promise<string> {
  const fromBridge = glasses ? await glasses.load(key) : ''
  if (fromBridge) return fromBridge
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function save(key: string, value: string): void {
  glasses?.save(key, value)
  try {
    localStorage.setItem(key, value)
  } catch {
    /* bridge store is the one that matters */
  }
}
function saveState(): void {
  save('ap.state', JSON.stringify({ line, playing, ts: Date.now() }))
}

// ── paging ───────────────────────────────────────────────────────────
const currentPage = () => Math.floor(line / layout.linesPerPage)

function relayout(): void {
  layout = layoutText(script, settings)
  line = Math.min(line, Math.max(0, layout.lines.length - 1))
  line = currentPage() * layout.linesPerPage
}

function render(): void {
  const empty = layout.lines.length === 0
  drawPage(pageCanvas, layout, currentPage(), empty ? HINT : undefined)

  // Phone preview, tinted like the glasses' green display.
  const ctx = els.preview.getContext('2d')!
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(pageCanvas, 0, 0)
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = '#4dff88'
  ctx.fillRect(0, 0, els.preview.width, els.preview.height)

  els.counter.textContent = `${arabicDigits(currentPage() + 1)} / ${arabicDigits(pageCount(layout))}`
  els.play.textContent = playing ? 'إيقاف مؤقت' : 'تشغيل تلقائي'
  els.play.classList.toggle('on', playing)
  glasses?.show(pageCanvas)
}

function goTo(page: number): boolean {
  const target = Math.max(0, Math.min(pageCount(layout) - 1, page))
  const moved = target !== currentPage()
  line = target * layout.linesPerPage
  render()
  saveState()
  return moved
}

// ── auto mode ────────────────────────────────────────────────────────
function pageDurationMs(): number {
  const start = currentPage() * layout.linesPerPage
  const words = layout.lines
    .slice(start, start + layout.linesPerPage)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length
  return Math.max(1500, (words / settings.wpm) * 60_000)
}

function schedule(): void {
  window.clearTimeout(timer)
  if (!playing) return
  timer = window.setTimeout(() => {
    if (!goTo(currentPage() + 1)) {
      autoSession = false
      setPlaying(false) // reached the end
      return
    }
    schedule()
  }, pageDurationMs())
}

function setPlaying(on: boolean): void {
  playing = on && layout.lines.length > 0
  window.clearInterval(heartbeat)
  // The Even app moves the page to a fresh hidden WebView when the phone is
  // locked; the heartbeat lets that copy tell "was playing a moment ago".
  if (playing) heartbeat = window.setInterval(saveState, 4000)
  schedule()
  render()
  saveState()
}

function manualStep(delta: number): void {
  goTo(currentPage() + delta)
  schedule() // restart the page timer after a manual move
}

function onGesture(g: Gesture): void {
  switch (g) {
    case 'swipeDown':
      manualStep(1)
      break
    case 'swipeUp':
      manualStep(-1)
      break
    case 'tap':
      // During an auto run a tap pauses/resumes; otherwise it turns the page.
      if (playing) setPlaying(false)
      else if (autoSession) setPlaying(true)
      else manualStep(1)
      break
    case 'doubleTap':
      glasses?.exit()
      break
    case 'refresh':
      glasses?.invalidate()
      render()
      break
  }
}
/** True from "auto play" until restart or the end of the script, so a tap on the glasses resumes a paused run. */
let autoSession = false

// ── phone UI ─────────────────────────────────────────────────────────
function syncControls(): void {
  els.size.querySelectorAll('button').forEach(b => b.classList.toggle('sel', Number(b.dataset.v) === settings.linesPerBand))
  els.area.querySelectorAll('button').forEach(b => b.classList.toggle('sel', (b.dataset.v === 'half') === settings.halfScreen))
  els.bold.checked = settings.bold
  els.wpm.value = String(settings.wpm)
  els.wpmVal.textContent = arabicDigits(settings.wpm)
}

function settingsChanged(): void {
  save('ap.settings', JSON.stringify(settings))
  syncControls()
  relayout()
  render()
  schedule()
}

let scriptSaveTimer: number | undefined
function scriptChanged(): void {
  script = els.script.value
  relayout()
  render()
  window.clearTimeout(scriptSaveTimer)
  scriptSaveTimer = window.setTimeout(() => save('ap.script', script), 500)
}

function bindUi(): void {
  els.prev.onclick = () => manualStep(-1)
  els.next.onclick = () => manualStep(1)
  els.play.onclick = () => {
    autoSession = !playing
    setPlaying(!playing)
  }
  els.restart.onclick = () => {
    autoSession = false
    setPlaying(false)
    goTo(0)
  }
  els.script.oninput = scriptChanged
  els.clear.onclick = () => {
    els.script.value = ''
    line = 0
    scriptChanged()
  }
  els.paste.onclick = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        els.script.value = text
        line = 0
        scriptChanged()
      }
    } catch {
      els.script.focus() // clipboard blocked: let the user long-press and paste
    }
  }
  els.size.onclick = e => {
    const v = (e.target as HTMLElement).dataset.v
    if (v) {
      settings.linesPerBand = Number(v)
      settingsChanged()
    }
  }
  els.area.onclick = e => {
    const v = (e.target as HTMLElement).dataset.v
    if (v) {
      settings.halfScreen = v === 'half'
      settingsChanged()
    }
  }
  els.bold.onchange = () => {
    settings.bold = els.bold.checked
    settingsChanged()
  }
  els.wpm.oninput = () => {
    settings.wpm = Number(els.wpm.value)
    settingsChanged()
  }
}

function setStatus(text: string, ok: boolean | null): void {
  els.status.textContent = text
  els.status.className = `status${ok === null ? '' : ok ? ' ok' : ' bad'}`
}

// ── boot ─────────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  // Canvas text falls back silently if the web font is not ready yet.
  await Promise.all([
    document.fonts.load(`500 40px ${FONT_FAMILY}`, 'نص'),
    document.fonts.load(`700 40px ${FONT_FAMILY}`, 'نص'),
  ]).catch(() => {})

  glasses = await Glasses.connect()

  const [savedScript, savedSettings, savedState] = await Promise.all([load('ap.script'), load('ap.settings'), load('ap.state')])
  script = savedScript
  try {
    if (savedSettings) settings = { ...DEFAULTS, ...JSON.parse(savedSettings) }
  } catch {
    /* keep defaults */
  }
  let resume = false
  try {
    if (savedState) {
      const s = JSON.parse(savedState) as { line?: number; playing?: boolean; ts?: number }
      line = Number(s.line) || 0
      resume = Boolean(s.playing) && Date.now() - Number(s.ts) < 15_000
    }
  } catch {
    /* start from the top */
  }

  els.script.value = script
  syncControls()
  bindUi()
  relayout()

  if (glasses) {
    glasses.onStatus = (t, ok) => setStatus(t, ok)
    const created = await glasses.createPage()
    setStatus(created ? 'متصل بالنظارة' : 'غير متصل بالنظارة', created)
    glasses.onGesture(onGesture)
  } else {
    setStatus('غير متصل بالنظارة', false)
  }

  render()
  if (resume) {
    autoSession = true
    setPlaying(true)
  }
}

void boot()
