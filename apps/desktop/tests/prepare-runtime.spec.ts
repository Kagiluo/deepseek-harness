/**
 * Runtime preparation: the Windows ZIP extraction that supplies the bundled
 * Node.js binary.
 *
 * The extraction replaced `extract-zip`, whose `yauzl`/`fd-slicer` read queue
 * stalled part-way through the Node archive on Node.js 24 while reporting no
 * error at all. These cases pin the replacement's observable contract — a real
 * ZIP is read, only the named members are written, and a missing member is a
 * loud failure rather than a silent partial extraction.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { zipSync, strToU8, strFromU8 } from 'fflate'
import { extractZipMembers } from '../scripts/prepare-runtime.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-prepare-runtime-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** One small archive shaped like the upstream Node.js ZIP. */
function nodeLikeArchive(): Uint8Array {
  return zipSync({
    'node-v24.17.0-win-x64/node.exe': strToU8('binary payload'),
    'node-v24.17.0-win-x64/npm.cmd': strToU8('@echo off'),
    'node-v24.17.0-win-x64/README.md': strToU8('# Node.js'),
    'node-v24.17.0-win-x64/node_modules/corepack/package.json': strToU8('{}'),
  })
}

describe('extractZipMembers', () => {
  it('writes only the named member and leaves the rest of the archive out', () => {
    const archive = join(root, 'node.zip')
    writeFileSync(archive, nodeLikeArchive())
    const destination = join(root, 'extract')

    extractZipMembers(
      readFileSync(archive),
      destination,
      ['node-v24.17.0-win-x64/node.exe'],
      archive,
    )

    const written = join(destination, 'node-v24.17.0-win-x64', 'node.exe')
    expect(existsSync(written)).toBe(true)
    expect(strFromU8(readFileSync(written))).toBe('binary payload')
    // The archive's other 1941-odd members are not expanded.
    expect(existsSync(join(destination, 'node-v24.17.0-win-x64', 'npm.cmd'))).toBe(false)
    expect(existsSync(join(destination, 'node-v24.17.0-win-x64', 'README.md'))).toBe(false)
  })

  it('creates the member path directories it needs', () => {
    const archive = join(root, 'node.zip')
    writeFileSync(archive, nodeLikeArchive())
    const destination = join(root, 'extract')

    extractZipMembers(
      readFileSync(archive),
      destination,
      ['node-v24.17.0-win-x64/node_modules/corepack/package.json'],
      archive,
    )

    expect(existsSync(join(destination, 'node-v24.17.0-win-x64', 'node_modules', 'corepack', 'package.json')))
      .toBe(true)
  })

  it('extracts several named members in one pass', () => {
    const archive = join(root, 'node.zip')
    writeFileSync(archive, nodeLikeArchive())
    const destination = join(root, 'extract')
    mkdirSync(destination, { recursive: true })

    extractZipMembers(readFileSync(archive), destination, [
      'node-v24.17.0-win-x64/node.exe',
      'node-v24.17.0-win-x64/npm.cmd',
    ], archive)

    expect(strFromU8(readFileSync(join(destination, 'node-v24.17.0-win-x64', 'node.exe'))))
      .toBe('binary payload')
    expect(strFromU8(readFileSync(join(destination, 'node-v24.17.0-win-x64', 'npm.cmd'))))
      .toBe('@echo off')
  })

  it('fails loudly when the archive does not hold a named member', () => {
    const archive = join(root, 'node.zip')
    writeFileSync(archive, nodeLikeArchive())
    const destination = join(root, 'extract')

    // A silent miss here is what let a partial runtime tree reach packaging.
    expect(() => { extractZipMembers(
      readFileSync(archive),
      destination,
      ['node-v24.17.0-win-x64/absent.exe'],
      archive,
    ) }).toThrow(/absent\.exe is absent from/u)
  })

  it('reports the archive path in the failure so the cause is identifiable', () => {
    const archive = join(root, 'node.zip')
    writeFileSync(archive, zipSync({ 'other/file.txt': strToU8('x') }))

    expect(() => { extractZipMembers(
      readFileSync(archive),
      join(root, 'extract'),
      ['node-v24.17.0-win-x64/node.exe'],
      archive,
    ) }).toThrow(new RegExp(archive.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  })
})
