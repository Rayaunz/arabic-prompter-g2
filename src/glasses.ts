// Everything that talks to the Even Hub bridge.

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  OsEventTypeList,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { SCREEN_W, SCREEN_H, TILE_W, TILE_H, TILES, tilePng } from './render'

export type Gesture = 'tap' | 'doubleTap' | 'swipeUp' | 'swipeDown' | 'refresh'

const EVENT_LAYER_ID = 1
const tileId = (i: number) => 2 + i
const tileName = (i: number) => `tile${i}`

export class Glasses {
  private sentKeys: (string | null)[] = [null, null, null, null]
  private pending: HTMLCanvasElement | null = null
  private pumping = false
  private lastSwipe = 0
  onStatus: (text: string, ok: boolean) => void = () => {}

  private constructor(private bridge: EvenAppBridge) {}

  /**
   * The SDK bridge also resolves in a plain browser (its calls just fail), so
   * null here only means the SDK never initialised at all.
   */
  static async connect(timeoutMs = 4000): Promise<Glasses | null> {
    const bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ])
    return bridge ? new Glasses(bridge) : null
  }

  async createPage(): Promise<boolean> {
    // Image containers cannot capture input, so a blank full-screen text
    // container sits behind them and receives taps and swipes.
    const eventLayer = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: SCREEN_W,
      height: SCREEN_H,
      borderWidth: 0,
      borderColor: 0,
      paddingLength: 0,
      containerID: EVENT_LAYER_ID,
      containerName: 'events',
      content: ' ',
      isEventCapture: 1,
    })
    const images = TILES.map(
      t =>
        new ImageContainerProperty({
          xPosition: t.x,
          yPosition: t.y,
          width: TILE_W,
          height: TILE_H,
          containerID: tileId(t.index),
          containerName: tileName(t.index),
        }),
    )
    const spec = { containerTotalNum: 1 + images.length, textObject: [eventLayer], imageObject: images }
    try {
      const result = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(spec))
      if (Number(result) === 0) return true
      // The start-up page can only be created once per launch. If this copy of
      // the page was reloaded by the host, rebuild the existing page instead.
      return await this.bridge.rebuildPageContainer(new RebuildPageContainer(spec))
    } catch {
      return false
    }
  }

  /**
   * Shows a page. Image sends must be strictly serial and each costs 100ms+,
   * so only the newest requested page is kept: if the wearer skips ahead
   * while a page is still going out, the stale one is abandoned mid-way.
   */
  show(page: HTMLCanvasElement): void {
    const copy = document.createElement('canvas')
    copy.width = page.width
    copy.height = page.height
    copy.getContext('2d')!.drawImage(page, 0, 0)
    this.pending = copy
    void this.pump()
  }

  /** Forget what the glasses currently show so the next show() resends everything. */
  invalidate(): void {
    this.sentKeys = [null, null, null, null]
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.pending) {
        const page = this.pending
        this.pending = null
        for (const tile of TILES) {
          if (this.pending) break // a newer page arrived
          const { bytes, key } = await tilePng(page, tile)
          if (this.sentKeys[tile.index] === key) continue
          const result = await this.bridge.updateImageRawData(
            new ImageRawDataUpdate({
              containerID: tileId(tile.index),
              containerName: tileName(tile.index),
              imageData: bytes,
            }),
          )
          if (String(result) === 'success') {
            this.sentKeys[tile.index] = key
            this.onStatus('متصل بالنظارة', true)
          } else {
            this.sentKeys[tile.index] = null
            this.onStatus(String(result) === 'sendFailed' ? 'غير متصل بالنظارة' : `فشل إرسال الصورة: ${String(result)}`, false)
          }
        }
      }
    } catch (err) {
      this.onStatus(`خطأ: ${err instanceof Error ? err.message : String(err)}`, false)
    } finally {
      this.pumping = false
    }
  }

  onGesture(handler: (g: Gesture) => void): void {
    // CLICK_EVENT is 0 and protobuf drops zero values, so a tap arrives with
    // eventType undefined. Resolve the default only inside an envelope that exists.
    const typeOf = (env?: { eventType?: number }): number | null => (env ? (env.eventType ?? 0) : null)

    this.bridge.onEvenHubEvent(event => {
      const sys = typeOf(event.sysEvent)
      const text = typeOf(event.textEvent)

      if (sys === OsEventTypeList.DOUBLE_CLICK_EVENT || text === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        handler('doubleTap')
        return
      }
      if (text === OsEventTypeList.SCROLL_TOP_EVENT || text === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
        const now = Date.now()
        if (now - this.lastSwipe < 250) return
        this.lastSwipe = now
        handler(text === OsEventTypeList.SCROLL_TOP_EVENT ? 'swipeUp' : 'swipeDown')
        return
      }
      if (sys === OsEventTypeList.CLICK_EVENT || text === OsEventTypeList.CLICK_EVENT) {
        handler('tap')
        return
      }
      if (sys === OsEventTypeList.FOREGROUND_ENTER_EVENT || sys === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
        handler('refresh')
      }
    })
  }

  /** Opens the system "exit app?" dialog (required on double tap). */
  exit(): void {
    void this.bridge.shutDownPageContainer(1)
  }

  async load(key: string): Promise<string> {
    try {
      return (await this.bridge.getLocalStorage(key)) || ''
    } catch {
      return ''
    }
  }

  save(key: string, value: string): void {
    void this.bridge.setLocalStorage(key, value).catch(() => {})
  }
}
