/**
 * Bounded frame queue between one terminal's output producer and its single
 * stream consumer.
 *
 * The queue exists because a terminal starts producing the moment it is
 * allocated, while its consumer arrives later: `open` returns an identity, and
 * the Client opens the output stream afterwards. Frames produced in that window
 * are retained here.
 *
 * Backpressure is real and one-way. Once the retained bytes reach the budget the
 * producer waits, so a stalled consumer cannot grow Host memory. The consumer is
 * never blocked: it drains whatever is retained and then waits for the next
 * frame or for the queue to close.
 */

import { Deque } from '@deepseek-ai/dsh-deque'
import type { InteractiveTerminalFrame } from './types.ts'

/**
 * Whether a generation's cancellation has fired.
 *
 * Read through a call because a generator checks it again after a suspension
 * point, where a direct property read would still be narrowed to the earlier
 * check's `false`.
 * @param signal - the generation's cancellation.
 * @returns true once the signal aborted.
 */
function cancelled(signal: AbortSignal): boolean {
  return signal.aborted
}

/** One terminal's retained frames, its byte budget, and its single consumer slot. */
export class FrameBuffer {
  private readonly frames = new Deque<InteractiveTerminalFrame>()
  private bytes = 0
  private closed = false
  private held = false
  private producerWait: (() => void) | undefined
  private consumerWait: (() => void) | undefined

  /** @param maxBytes - inclusive budget for retained output bytes. */
  constructor(private readonly maxBytes: number) {}

  /** Whether one stream generation currently holds the consumer slot. */
  get consuming(): boolean {
    return this.held
  }

  /**
   * Retain one frame, waiting while the byte budget is spent.
   *
   * A `failed` or `exit` frame is never delayed: it is the producer's last word,
   * and withholding it would leave a consumer waiting on a terminal that is
   * already gone.
   * @param frame - the frame to retain.
   * @returns once the frame is retained or the queue is closed.
   */
  async push(frame: InteractiveTerminalFrame): Promise<void> {
    const final = frame.kind !== 'output'
    while (!this.closed && !final && this.bytes >= this.maxBytes) {
      await new Promise<void>((resolve) => { this.producerWait = resolve })
    }
    if (this.closed) return
    this.frames.pushBack(frame)
    if (frame.kind === 'output') this.bytes += frame.data.byteLength
    this.releaseConsumer()
  }

  /**
   * Take the consumer slot for one stream generation.
   * @returns true when this generation holds the slot, false when another does.
   */
  acquire(): boolean {
    if (this.held) return false
    this.held = true
    return true
  }

  /** Release the consumer slot and let a waiting producer resume. */
  release(): void {
    this.held = false
    this.releaseProducer()
  }

  /** Stop accepting frames and let a waiting consumer finish after draining. */
  close(): void {
    this.closed = true
    this.releaseConsumer()
    this.releaseProducer()
  }

  /**
   * Drain retained frames and then follow the producer until the queue closes.
   * @param signal - cancellation of this generation; the slot is released either way.
   * @returns retained frames in production order.
   */
  async *iterate(signal: AbortSignal): AsyncGenerator<InteractiveTerminalFrame> {
    const abort = (): void => { this.releaseConsumer() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      for (;;) {
        if (cancelled(signal)) return
        while (this.frames.size > 0) {
          const frame = this.frames.popFront() as InteractiveTerminalFrame
          if (frame.kind === 'output') this.bytes -= frame.data.byteLength
          this.releaseProducer()
          yield frame
          if (cancelled(signal)) return
        }
        if (this.closed || cancelled(signal)) return
        await new Promise<void>((resolve) => { this.consumerWait = resolve })
        this.consumerWait = undefined
      }
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  /** Wake a producer waiting on the byte budget. */
  private releaseProducer(): void {
    const waiting = this.producerWait
    this.producerWait = undefined
    waiting?.()
  }

  /** Wake a consumer waiting for the next frame or for closure. */
  private releaseConsumer(): void {
    const waiting = this.consumerWait
    this.consumerWait = undefined
    waiting?.()
  }
}
