/**
 * The terminal tab's body: one xterm.js emulator over one Host terminal.
 *
 * The component owns exactly the emulator and its lifetime. Allocation, input,
 * resize, and closure all go through the injected face, which is already bound
 * to this Session, and the Host's frames are the only writer to the emulator's
 * screen: a keystroke is forwarded as input and never echoed locally, so the
 * reader sees what the shell sent rather than a second, divergent rendering.
 *
 * The effect is keyed by the tab record, and its cleanup ends the Host terminal,
 * so closing a tab closes its process while a hidden tab keeps both.
 */
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalWireStatus } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TerminalInjected } from './face.ts'
import type {} from './locales.ts'
import css from './terminal.module.css'

/** The body's composed props: the tab it draws, its injected face, and its copy. */
export type TerminalBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & TerminalInjected
  & PropsLocale<'terminal'>

/** What the body shows under the emulator when the terminal is not simply running. */
type Notice =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'ended'; readonly text: string }
  | { readonly kind: 'failed'; readonly text: string }

/** Rows of scrollback the emulator keeps locally. */
const SCROLLBACK_ROWS = 5000

/**
 * Decode one base64 frame into the bytes the emulator consumes.
 * @param data - base64 text as the Host sent it.
 * @returns the decoded bytes.
 */
export function decodeFrame(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * The terminal body.
 * @param props - the tab record, the injected face, and the namespace translate.
 * @returns the emulator host and its status line.
 */
export function TerminalBody({ useTabInfo, open, write, resize, close, output, t }: TerminalBodyProps) {
  const { signal } = useTabInfo().tab
  const host = useRef<HTMLDivElement>(null)
  const [notice, setNotice] = useState<Notice | undefined>({ kind: 'connecting' })

  // Keyed by the tab record's own signal, not the tab value: the value changes
  // identity whenever the layout does — a focus change, an expand — and this
  // effect must outlive all of those to keep one process behind one tab.
  useEffect(() => {
    const element = host.current
    /* v8 ignore next -- the ref is always attached by effect time: the emulator host renders unconditionally. */
    if (element === null) return
    const terminal = new Terminal({ cursorBlink: true, scrollback: SCROLLBACK_ROWS })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)

    const controller = new AbortController()
    const endHostTerminal = (): void => { controller.abort(signal.reason) }
    signal.addEventListener('abort', endHostTerminal, { once: true })

    let terminalId: string | undefined
    const fitToHost = (): void => {
      // A collapsed or not-yet-laid-out panel has no cells to fit; measuring it
      // would ask the addon for a zero-sized grid.
      if (element.clientWidth === 0 || element.clientHeight === 0) return
      fit.fit()
      if (terminalId !== undefined) resize(terminalId, terminal.cols, terminal.rows)
    }
    const input = terminal.onData((data) => {
      if (terminalId !== undefined) write(terminalId, data)
    })
    const measured = new ResizeObserver(fitToHost)
    measured.observe(element)
    fitToHost()

    void (async () => {
      const opened = await open(terminal.cols, terminal.rows, controller.signal)
      if (!opened.ok) {
        setNotice({ kind: 'failed', text: t('error.failed', { message: opened.error.message }) })
        return
      }
      terminalId = opened.value.terminalId
      setNotice(undefined)
      try {
        for await (const frame of output(terminalId, controller.signal)) {
          if (frame.kind === 'output') terminal.write(decodeFrame(frame.data))
          else if (frame.kind === 'failed') setNotice({ kind: 'failed', text: t('error.failed', { message: frame.message }) })
          else setNotice({ kind: 'ended', text: exitText(t, frame.status) })
        }
      } catch (error: unknown) {
        // A cancelled generation is this effect's own cleanup, not a failure.
        if (!controller.signal.aborted) {
          setNotice({ kind: 'failed', text: t('error.failed', { message: String(error) }) })
        }
      }
    })()

    return () => {
      signal.removeEventListener('abort', endHostTerminal)
      measured.disconnect()
      input.dispose()
      controller.abort()
      if (terminalId !== undefined) close(terminalId)
      terminal.dispose()
    }
  }, [signal, open, write, resize, close, output, t])

  return (
    <div className={css.root}>
      <div className={css.host} ref={host} data-interactive-terminal />
      {notice === undefined ? null : (
        <p className={css.notice} role="status">{noticeText(notice, t)}</p>
      )}
    </div>
  )
}

/**
 * Say how a terminal process ended.
 * @param t - namespace-bound translate.
 * @param status - the terminal outcome the Host reported.
 * @returns the line to show.
 */
export function exitText(t: TerminalBodyProps['t'], status: TerminalWireStatus): string {
  if (status.kind === 'running') return t('status.ended')
  if (status.signal !== null) return t('status.signalled', { signal: status.signal })
  if (status.exitCode !== null) return t('status.exited', { code: String(status.exitCode) })
  return t('status.ended')
}

/**
 * Render one notice for the reader.
 * @param notice - the current notice.
 * @param t - namespace-bound translate.
 * @returns the line to show.
 */
function noticeText(notice: Notice, t: TerminalBodyProps['t']): string {
  return notice.kind === 'connecting' ? t('connecting') : notice.text
}
