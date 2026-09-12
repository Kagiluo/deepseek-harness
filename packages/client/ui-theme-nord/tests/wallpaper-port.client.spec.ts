// @vitest-environment jsdom
/**
 * The port onto the Host store: it resolves the generated namespace per call
 * (the Client assembly mounts it from another plugin's apply), encodes bytes for
 * the JSON-only Remote boundary, and reports a failure by throwing.
 */
import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createWallpaperPort, type WallpaperNamespace } from '../src/client/wallpaper.ts'

const BYTES = new Uint8Array([1, 2, 3, 250, 251])
const BASE64 = btoa(String.fromCharCode(...BYTES))

/**
 * A namespace stub that records what the port sent.
 * @returns the stub and the calls it recorded.
 */
function namespaceStub() {
  const puts: { mediaType: string; base64: string }[] = []
  const gets: string[] = []
  const namespace = {
    async put(upload: { mediaType: string; base64: string }): Promise<RemoteResult<never>> {
      puts.push(upload)
      return { ok: true, value: { id: 'hash', mediaType: upload.mediaType, bytes: BYTES.length } as never }
    },
    async get(id: string): Promise<RemoteResult<string>> {
      gets.push(id)
      return { ok: true, value: BASE64 }
    },
  } as unknown as WallpaperNamespace
  return { namespace, puts, gets }
}

const file = (type = 'image/png'): File => new File([BYTES], 'holiday.png', { type })

describe('the wallpaper port', () => {
  it('encodes the picked file as the base64 the Remote boundary carries', async () => {
    const stub = namespaceStub()
    const port = createWallpaperPort(() => stub.namespace)
    const stored = await port.store(file())
    expect(stub.puts).toEqual([{ mediaType: 'image/png', base64: BASE64 }])
    expect(stored).toMatchObject({ id: 'hash', mediaType: 'image/png' })
  })

  it('resolves the namespace on every call, not when the port is built', async () => {
    const stub = namespaceStub()
    // The assembly mounts its namespace after this plugin activates, so the
    // holder is filled in after the port exists.
    const mounted: { current: WallpaperNamespace | undefined } = { current: undefined }
    const port = createWallpaperPort(() => mounted.current)
    await expect(port.store(file())).rejects.toThrow(/not mounted/u)
    mounted.current = stub.namespace
    await expect(port.store(file())).resolves.toMatchObject({ id: 'hash' })
  })

  it('reports a Remote failure with the message the Host sent', async () => {
    const failing = {
      async put(): Promise<RemoteResult<never>> {
        return { ok: false, error: new Error('theme wallpaper: unsupported media type "image/tiff"') as never }
      },
      async get(): Promise<RemoteResult<string>> {
        return { ok: false, error: new Error('missing') as never }
      },
    } as unknown as WallpaperNamespace
    const port = createWallpaperPort(() => failing)
    await expect(port.store(file('image/tiff'))).rejects.toThrow(/unsupported media type/u)
    await expect(port.read('gone' as never, 'image/png')).rejects.toThrow(/missing/u)
  })

  it('hands out a preview URL it can release', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const port = createWallpaperPort(() => undefined)
    const url = port.preview(file())
    expect(url).toMatch(/^blob:/u)
    port.release(url)
    expect(revoke).toHaveBeenCalledWith(url)
    revoke.mockRestore()
  })

  it('decodes stored bytes into a displayable blob URL', async () => {
    const stub = namespaceStub()
    const port = createWallpaperPort(() => stub.namespace)
    const url = await port.read('hash' as never, 'image/png')
    expect(stub.gets).toEqual(['hash'])
    expect(url).toMatch(/^blob:/u)
    port.release(url)
  })
})
