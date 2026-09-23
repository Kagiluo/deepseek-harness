import { describe, expect, it } from 'vitest'
import { FrameBuffer } from '../src/buffer.ts'
import type { InteractiveTerminalFrame } from '../src/types.ts'

/** An output frame carrying one ASCII string. */
function chunk(text: string): { kind: 'output'; data: Uint8Array } {
  return { kind: 'output', data: Buffer.from(text, 'utf8') }
}

/** Drain every frame one generation yields. */
async function drain(buffer: FrameBuffer, signal = new AbortController().signal): Promise<unknown[]> {
  const seen: unknown[] = []
  for await (const frame of buffer.iterate(signal)) seen.push(frame)
  return seen
}

/** Let pending microtasks and one macrotask run, so a settled promise is observable. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
}

describe('FrameBuffer', () => {
  it('retains frames produced before a consumer arrives', async () => {
    const buffer = new FrameBuffer(1024)
    await buffer.push(chunk('early'))
    await buffer.push(chunk('later'))
    buffer.close()

    expect(await drain(buffer)).toEqual([chunk('early'), chunk('later')])
  })

  it('wakes a waiting consumer when a later frame arrives', async () => {
    const buffer = new FrameBuffer(1024)
    const iterator = buffer.iterate(new AbortController().signal)[Symbol.asyncIterator]()
    const pending = iterator.next()
    await settle()
    await buffer.push(chunk('live'))
    expect(await pending).toEqual({ done: false, value: chunk('live') })
  })

  it('hands the consumer slot to exactly one generation', () => {
    const buffer = new FrameBuffer(1024)
    expect(buffer.consuming).toBe(false)
    expect(buffer.acquire()).toBe(true)
    expect(buffer.consuming).toBe(true)
    expect(buffer.acquire()).toBe(false)
    buffer.release()
    expect(buffer.consuming).toBe(false)
    expect(buffer.acquire()).toBe(true)
  })

  it('holds the producer once the byte budget is spent, then resumes as the consumer drains', async () => {
    const buffer = new FrameBuffer(4)
    await buffer.push(chunk('abcd'))
    const blocked = buffer.push(chunk('e'))
    let settled = false
    void blocked.then(() => { settled = true })
    await settle()
    expect(settled).toBe(false)

    buffer.acquire()
    const iterator = buffer.iterate(new AbortController().signal)[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: chunk('abcd') })
    await blocked
    expect(settled).toBe(true)
    expect(await iterator.next()).toEqual({ done: false, value: chunk('e') })
  })

  it('never delays the producer’s final frame', async () => {
    const buffer = new FrameBuffer(1)
    await buffer.push(chunk('x'))
    await buffer.push({ kind: 'exit', status: { kind: 'exited', exitCode: 0, signal: null } })
    buffer.close()
    expect((await drain(buffer)).map(frame => (frame as InteractiveTerminalFrame).kind)).toEqual(['output', 'exit'])
  })

  it('ignores a frame pushed after the queue closed', async () => {
    const buffer = new FrameBuffer(1024)
    buffer.close()
    await buffer.push(chunk('dropped'))
    expect(await drain(buffer)).toEqual([])
  })

  it('releases a producer waiting on the byte budget when the queue closes', async () => {
    const buffer = new FrameBuffer(1)
    await buffer.push(chunk('x'))
    const blocked = buffer.push(chunk('y'))
    buffer.close()
    await expect(blocked).resolves.toBeUndefined()
  })

  it('ends a generation when its signal aborts while it waits', async () => {
    const buffer = new FrameBuffer(1024)
    const controller = new AbortController()
    const pending = buffer.iterate(controller.signal)[Symbol.asyncIterator]().next()
    await settle()
    controller.abort()
    await expect(pending).resolves.toEqual({ done: true, value: undefined })
  })

  it('stops yielding after an abort observed between frames', async () => {
    const buffer = new FrameBuffer(1024)
    await buffer.push(chunk('first'))
    await buffer.push(chunk('second'))
    const controller = new AbortController()
    const seen: unknown[] = []
    for await (const frame of buffer.iterate(controller.signal)) {
      seen.push(frame)
      controller.abort()
    }
    expect(seen).toEqual([chunk('first')])
  })

  it('reports closure to a consumer that waited with nothing retained', async () => {
    const buffer = new FrameBuffer(1024)
    const pending = buffer.iterate(new AbortController().signal)[Symbol.asyncIterator]().next()
    await settle()
    buffer.close()
    await expect(pending).resolves.toEqual({ done: true, value: undefined })
  })

  it('stops iterating when the queue closed with frames still retained and the signal aborted', async () => {
    const buffer = new FrameBuffer(1024)
    const controller = new AbortController()
    controller.abort()
    await buffer.push(chunk('unread'))
    buffer.close()
    expect(await drain(buffer, controller.signal)).toEqual([])
  })
})
