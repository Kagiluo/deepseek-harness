---
description: "Desktop in-box theme plugin: the Nord light and dark palette as ten tunable roles with a derived alias-token layer, a stored background image, and the tuner in Settings → Plugins."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-theme-nord

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-theme-nord` is the Desktop application's own appearance: a light and dark palette plus a background image, edited from one tab in Settings → Plugins. Ten roles — base background, three surface levels, text, two brand accents, and the three states — drive every `--dsw-alias-*` and `--dsw-specific-*` token the ui-theme sheets declare, so retuning one role moves every surface that reads it. The browser half stacks that derivation on `ctx.theme`; the Host half declares the tuner's `Config` and stores the picked image under the Harness home.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open Settings → Plugins and pick the Nord palette tab. Every edit previews immediately — the ten colors restack the token layer as they change, so the whole window follows while the user drags a color picker. Nothing is written until Save, and Discard drops the drafts; Reset returns one role or all ten to the composition's defaults.

### Mounting it

A Desktop composition mounts the row from the runtime-side overlay (`apps/desktop-host/config/desktop.cordis.patch.yml`), whose inserted rows resolve by bare package name from the packaged runtime:

```yaml
- insert:
    - id: ui-theme-nord
      name: '@deepseek-ai/dsh-client-ui-theme-nord'
```

The tuner's values live under the row's entry id, `ui-theme-nord`: the settings service serves each plugin's `Config` as a form under the id its Loader entry mounts, and the browser half reads that form through `ctx.configForms`. A composition may supply the ten roles through the row's `config`; an unwritten settings document resolves to the North palette the schema declares. A CLI or Web composition mounts the same row through a profile bundle or a `--patch` overlay. The package declares no `dsh.bundle`, because it is not a profile bundle: the row names it directly.

### The background image

Choose image opens the operating system's file dialog and stores the picked file on the Host, addressed by its content hash. The opacity slider decides how much of it the application base surface gives up; cards, menus, and other raised surfaces stay opaque, so copy keeps its contrast. Removing the image returns the base surface to the palette color. The image reference is written with the rest of the tab, so a discarded pick leaves an unreferenced file rather than a wrong background.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The palette is ten roles per color scheme, each entry a light and a dark value. `buildTokens` derives the complete alias-token map from them; `ctx.theme.overrideTokens` stacks the result inside `ctx.effect`, so unloading the plugin restores the built-in palettes. The tuner's controller keeps a staged draft palette — every edit rebuilds the layer, while the settings document is written only on save. The settings form stays the authority: the controller reads accepted values back from the form instead of predicting them, and it writes role edits as atomic mutations of the role's `light`/`dark` leaves because a role is a nested object rather than a top-level field.

The background image is stored as bytes under `$DSH_HOME/theme-wallpaper/{sha256}` with a `.type` sibling, and the settings document carries only the hash and the media type, so the settings wire never moves image bytes. Bytes cross the Remote boundary base64-encoded, because that boundary carries JSON only; the store caps one image at 8 MiB and accepts the media types a browser displays. Two layers paint the background: an opaque floor holding the palette's base color, and the image above it at the staged opacity. The base-surface token gives up exactly that opacity, which is what lets the image show through the shell frame while raised surfaces keep their opaque tokens.

### Why an override layer rather than a registered theme

`ctx.theme.register()` would add a named theme, but a third-party theme id does not cross the built-in settings schema, so the Appearance control could not select it. An override layer instead sits on top of whichever built-in theme the user picks and supplies the matching value through each entry's `colorScheme`, which is why this package covers both palettes rather than one.

### Full token coverage

`buildTokens` carries one entry per token the ui-theme alias sheet declares, so the scheme is complete rather than partial. Aurora hues bare do not reach text contrast, so the three state families use a darkened variant in the light palette and a lightened one in the dark palette; that deviation from the published palette is deliberate.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages own the layers this package extends.

- [ui-theme](../ui-theme/README.md) — the theme registry, the alias sheets, and the override-layer contract this package consumes.
- [ui-settings](../ui-settings/README.md) — the config-forms service this plugin's tuner reads and the Plugins tab slot it fills.
- [file-upload](../file-upload/README.md) — the other client package that pairs a browser half with a Host Remote contribution.
- [Web styling](../../../docs/web-styling.md) — the token ownership rules.
- [Desktop application](../../../apps/desktop/README.md) — the profile, runtime closure, and in-box row composition.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side appearance layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the plugin claims to own. They are current package constraints, not a task backlog.

- **Ten roles, not every token** — a value the palette does not name (overlay scrims, media tool-bar chips, and the mask ramps) stays literal in both schemes; adding one means a role plus its derivation, not a one-off token.
- **Syntax highlighting does not follow** — the ui-theme shiki sheet aliases only the code-block background and foreground; its `--shiki-token-*` values are literals, so highlighted tokens keep the built-in colors.
- **An unreferenced image can outlive its pick** — the store is content-addressed and never garbage-collected, so a discarded pick leaves its bytes under `$DSH_HOME/theme-wallpaper` until the same image is picked again or an operator removes them.
- **A stored image is read back through one Remote round trip** — restoring the stored image after a discarded pick reads its bytes again rather than caching them, and an image whose file is missing reports a failure instead of falling back to the palette color.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Host half is a class plugin: it declares the tuner's `Config`, whose roles and background-image fields are all volatile so the settings service exposes them as editable fields, and opts out of the automatic form because the tab owns the layout; it also provides the `themeWallpaper` Remote namespace, which `packages/api/remotes` mounts for the application's Client assembly.

</details>

**Runtime invariant:** No companion is published. The controller stacks exactly one override layer per instance and proves its release on dispose, and the Host reports what it accepted so a rejected write stays visible as an unsaved draft.
