# Agent Note: Desktop Nord theme plugin with a stored background image

Status: implemented

English | [中文](2026-09-12-desktop-nord-theme-plugin.zh.md)

## Problem

The Desktop application ships one fixed appearance: the built-in light and dark palettes that `ui-theme` declares. A user who wants different colors, or a background image behind the interface, has no supported way to get one. The Web client already exposes the extension point such a plugin needs — `ctx.theme.overrideTokens` restacks alias tokens per source — and nothing in the Desktop composition used it.

The distribution route is the harder half. The Desktop installer accepts only `registry.npmjs.org` package names and pins an empty user npm configuration, so an out-of-tree plugin cannot be installed into a user's profile, and the compiled application cannot be handed launch arguments that would mount a `--patch` overlay. Whatever ships has to be inside the application's own runtime closure.

## Decision

`@deepseek-ai/dsh-client-ui-theme-nord` is a release member of the dsh family that the Desktop composition mounts as an in-box row (`apps/desktop-host/config/desktop.cordis.patch.yml`, resolved from a dependency of `apps/desktop-host`). Because it is not private, the dsh release pack carries it into the runtime closure like any other family package, which is what puts both halves on the profile that the application opens.

The palette is ten roles per color scheme — base background, three surface levels, text, two brand accents, and the three states. `buildTokens` derives every `--dsw-alias-*` and `--dsw-specific-*` token the ui-theme sheets declare from those roles, and the browser half stacks the result as one override layer on `ctx.theme`, so retuning one role moves every surface that reads it, and switching Appearance between light and dark keeps working.

The tuner is the Plugins section's tab. Edits are staged: each one rebuilds the layer so the window follows the color picker immediately, while the settings document is written only when the user saves. The Host document stays the authority — the browser half reads the accepted values back from its `configForms` form instead of predicting them, so a rejected write remains visible as an unsaved draft. The Host half declares that Config with every palette role volatile, which is what makes the roles editable fields under the row's entry id, and it opts out of the settings service's automatic form because the tab owns the layout.

The background image is stored outside the settings document. The Host half accepts base64 bytes over a Remote namespace (`themeWallpaper`), validates the media type and an 8 MiB cap, and writes them under `$DSH_HOME/theme-wallpaper/{sha256}` with a `.type` sibling; the settings document carries only the hash and the media type, so neither the settings wire nor the durable document moves image bytes. The image reference is saved with the rest of the tab while the bytes are stored as soon as the user picks them, because the store is content-addressed: a discarded pick leaves an unreferenced file rather than a wrong background.

The image is painted as two layers behind every in-flow element — an opaque floor holding the palette's base color, and the image above it at the staged opacity. The base-surface token gives up exactly that opacity, which is what lets the image show through the shell frame while raised surfaces keep their opaque tokens and copy keeps its contrast.

## Alternatives considered

**Distributing it as a registry-installed plugin.** The published route was built first and abandoned: the registry is immutable, so the code would be permanently public, and the Desktop installer only accepts `registry.npmjs.org` names — an out-of-tree bundle would have had to be published there to be installable at all.

**A profile bundle or a `--patch` overlay.** Both mount a plugin without touching the application, and both need launch arguments the compiled Desktop application does not provide.

**Registering a named theme instead of stacking an override layer.** `ctx.theme.register()` adds a theme id, but a third-party id does not cross the built-in settings schema, so the Appearance control could not select it. An override layer sits on top of whichever built-in theme is active, which is why this package covers both palettes.

**Keeping the Remote's wire types in a module both faces compile.** The client face and the Host face would each emit the same declaration file; TypeScript refuses to build the program that reads its own output there (`TS5055`). The client half now derives those types from the assembly's declaration — `ClientRemote['themeWallpaper']` — and does not compile that module at all. `packages/client/file-upload` avoids the same conflict for the same reason.

**Storing the image in the settings document, or in browser storage.** The first makes every settings read and write carry megabytes; the second loses the image whenever the browser profile is cleared, and neither is the Harness home the user asked for.

## Consequences

The plugin is Desktop-only in practice: it is a family package, but its row and its palette defaults live in the Desktop composition, and nothing else mounts it. The image store never garbage-collects, so discarding a pick leaves its bytes until the same image is picked again or an operator removes them. Restoring the stored image after a discarded pick reads its bytes back instead of caching them.

## Testing

`tests/theme.host.spec.ts` covers the Host half: the schema defaults, the volatile marker on every editable field, the requested plugin-owned page, a content-addressed round trip, repeat stores of one image, and the refusals (unsupported media type, empty body, past the cap, a missing id). `tests/theme.client.spec.ts` covers the token derivation against the ui-theme sheet, the wallpaper token algebra, and the tuner's staging: preview without write, save, discard, removal, opacity, a failed store, an unreadable stored image, and the layer's release on dispose.

## Related

- [ui-theme README](../../../../packages/client/ui-theme/README.md) — the token sheets and the override-layer contract this package consumes.
- [Web styling](../../../../docs/web-styling.md) — the token ownership rules.
