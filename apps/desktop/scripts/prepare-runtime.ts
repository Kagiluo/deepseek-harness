/** Download and verify the upstream Node.js runtime and copy the pinned pnpm CLI. */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { chmod, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { unzipSync } from 'fflate'
import { extract } from 'tar'
import { resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'

const NODE_VERSION = '24.17.0'
const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const RUNTIME_ROOT = BUILD_PATHS.runtime
const DOWNLOAD_ROOT = BUILD_PATHS.downloads

type RuntimePlatform = 'darwin' | 'linux' | 'win'
type RuntimeArch = 'arm64' | 'x64'

function target(): { platform: RuntimePlatform; arch: RuntimeArch } {
  const rawPlatform = process.env.DSH_DESKTOP_TARGET_PLATFORM ?? process.env.npm_config_platform ?? process.platform
  const rawArch = process.env.DSH_DESKTOP_TARGET_ARCH ?? process.env.npm_config_arch ?? process.arch
  const platform = rawPlatform === 'win32' ? 'win' : rawPlatform
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win') {
    throw new Error(`desktop runtime: unsupported platform ${rawPlatform}`)
  }
  if (rawArch !== 'arm64' && rawArch !== 'x64') throw new Error(`desktop runtime: unsupported architecture ${rawArch}`)
  return { platform, arch: rawArch }
}

async function download(url: string, path: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`desktop runtime: ${url} returned HTTP ${String(response.status)}`)
  writeFileSync(path, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 })
}

/**
 * Extract named members from a ZIP archive.
 *
 * `extract-zip` is deliberately not used: it reaches `yauzl@2.10.0`, whose
 * `fd-slicer` read queue stalls part-way through a large archive on Node.js 24
 * — the runtime this script downloads, and a range the repository's `engines`
 * admits. The filter extracts only the members the caller names, so peak memory
 * tracks that member rather than the archive.
 * @param archiveBytes - The complete archive contents.
 * @param destinationRoot - Directory the member paths are written under.
 * @param members - Archive-relative member names to extract.
 * @param archive - Archive path used in diagnostics.
 * @throws {Error} when the archive does not hold one of the named members.
 */
export function extractZipMembers(
  archiveBytes: Uint8Array,
  destinationRoot: string,
  members: readonly string[],
  archive: string,
): void {
  const wanted = new Set(members)
  const files = unzipSync(archiveBytes, { filter: file => wanted.has(file.name) })
  for (const member of members) {
    const bytes = files[member]
    if (bytes === undefined) throw new Error(`desktop runtime: ${member} is absent from ${archive}`)
    const destination = join(destinationRoot, ...member.split('/'))
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, bytes)
  }
}

async function prepareNode(platform: RuntimePlatform, arch: RuntimeArch): Promise<void> {
  const extension = platform === 'win' ? 'zip' : 'tar.gz'
  const folder = `node-v${NODE_VERSION}-${platform}-${arch}`
  const archiveName = `${folder}.${extension}`
  const releaseRoot = `https://nodejs.org/download/release/v${NODE_VERSION}`
  const archive = join(DOWNLOAD_ROOT, archiveName)
  const sums = join(DOWNLOAD_ROOT, `node-v${NODE_VERSION}-SHASUMS256.txt`)
  if (!existsSync(archive)) await download(`${releaseRoot}/${archiveName}`, archive)
  if (!existsSync(sums)) await download(`${releaseRoot}/SHASUMS256.txt`, sums)
  const line = (await readFile(sums, 'utf8')).split(/\r?\n/u)
    .find(candidate => candidate.endsWith(`  ${archiveName}`))
  if (line === undefined) throw new Error(`desktop runtime: ${archiveName} is absent from Node.js SHASUMS256.txt`)
  const expected = line.split(/\s+/u)[0]
  const actual = createHash('sha256').update(await readFile(archive)).digest('hex')
  if (actual !== expected) throw new Error(`desktop runtime: checksum mismatch for ${archiveName}`)

  const extraction = BUILD_PATHS.nodeExtract
  rmSync(extraction, { recursive: true, force: true })
  mkdirSync(extraction, { recursive: true })
  // Only the runtime binary is consumed below, so the Windows path extracts that
  // one member instead of expanding the complete archive.
  if (platform === 'win') extractZipMembers(readFileSync(archive), extraction, [`${folder}/node.exe`], archive)
  else await extract({ cwd: extraction, file: archive })
  const source = join(extraction, folder, platform === 'win' ? 'node.exe' : 'bin/node')
  const destinationRoot = join(RUNTIME_ROOT, 'node')
  const destination = join(destinationRoot, platform === 'win' ? 'node.exe' : 'node')
  rmSync(destinationRoot, { recursive: true, force: true })
  mkdirSync(destinationRoot, { recursive: true })
  // A fresh write prevents macOS from retaining invalid code-signature vnode state from a tar-extracted Mach-O clone.
  await pipeline(createReadStream(source), createWriteStream(destination, { flags: 'wx' }))
  if (platform !== 'win') await chmod(destination, 0o755)
  const hostPlatform = process.platform === 'win32' ? 'win' : process.platform
  const hostCanExecute = platform === hostPlatform
    && (arch === process.arch || (platform === 'darwin' && arch === 'x64' && process.arch === 'arm64'))
  if (hostCanExecute) {
    const result = spawnSync(destination, ['--version'], { encoding: 'utf8' })
    if (result.error !== undefined || result.status !== 0 || result.stdout.trim() !== `v${NODE_VERSION}`) {
      const detail = result.error?.message ?? result.signal ?? result.stderr.trim()
      const outcome = detail === '' ? `exit ${String(result.status)}` : detail
      throw new Error(`desktop runtime: prepared Node.js ${NODE_VERSION} failed executable verification: ${outcome}`)
    }
  }
  rmSync(extraction, { recursive: true, force: true })
}

function preparePnpm(): string {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('pnpm')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('desktop runtime: pnpm manifest has no version')
  const packageDir = dirname(manifestPath)
  const destination = join(RUNTIME_ROOT, 'pnpm')
  rmSync(destination, { recursive: true, force: true })
  cpSync(packageDir, destination, { recursive: true })
  return manifest.version
}

async function main(): Promise<void> {
  const { platform, arch } = target()
  mkdirSync(DOWNLOAD_ROOT, { recursive: true })
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  await prepareNode(platform, arch)
  const pnpmVersion = preparePnpm()
  writeFileSync(join(RUNTIME_ROOT, 'versions.json'), `${JSON.stringify({
    schemaVersion: 1,
    node: NODE_VERSION,
    pnpm: pnpmVersion,
  }, undefined, 2)}\n`)
}

if (import.meta.main) await main()
