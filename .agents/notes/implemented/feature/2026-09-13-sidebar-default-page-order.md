# Agent Note: Sidebar default page order

Status: implemented

English | [中文](2026-09-13-sidebar-default-page-order.zh.md)

## Problem

[The recorded selection rule](2026-09-08-sidebar-default-pages.md) opened the sole registered guide entry directly and fell back to the guide as soon as a second type contributed an entry. Adding the Terminal tab to the right Sidebar therefore changed the page every column opens on: a pane that had always received the workspace file tree received the guide instead, and lost the strip's add control with it, because a pane holding a guide draws none. A new door replaced the surface a user already had.

## Decision

The default page is the registered guide entry with the lowest `order`, and the guide opens only when no type contributed an entry. `order` is already the guide's listing position, so the entry a composition wants listed first is the one its columns open on. The shipped composition keeps its page: `files` (order 10) still opens a fresh pane, and the terminal (order 20) adds a door without displacing it. The number of entries no longer decides.

Selection stays in `defaultSeed`, which reads the registry's ordered guide list; a selected kind nothing registered still fails loud.

## Alternatives considered

**Opening the guide whenever several entries exist.** Rejected: a new page kind would then change what every column opens on, and because a pane that opens on the guide draws no add control, a user would lose both the file tree and the way to the guide in one step.

**Naming `files` as the default.** Rejected: it puts one plugin's kind into the Sidebar's own selection rule, and a composition that omits that type would fail to seed at all.

**Keeping the terminal off the guide.** Rejected: the guide is the only door a page kind has, so a tab type without an entry box cannot be opened.

## Consequences

The rule reads a value each contributing type already sets for the guide's listing, so a composition orders its doors once and gets the same order for the default page and the list. A type contributing several entries opens on its own lowest-ordered one.

The default page is no longer readable from the entry count, so a composition that wants the guide to open a fresh column must contribute no entries at all.

## Testing

[`tab-registry.client.spec.ts`](../../../../packages/client/ui-sidebar-right/tests/tab-registry.client.spec.ts) covers the three outcomes — the lowest-ordered entry whatever the registration order, a sole entry, and the guide with none — beside the unregistered-kind throw. [`seat.client.spec.tsx`](../../../../packages/client/ui-sidebar-right/tests/seat.client.spec.tsx) drives the seated column over the real plugin for zero, one, and two entries. [`sidebar-right.e2e.ts`](../../../../apps/web/tests/sidebar-right.e2e.ts) keeps its Files expectations on a settled session and after a reload, so the shipped surface stays pinned where a user sees it.

## Related

- [Sidebar default pages](2026-09-08-sidebar-default-pages.md) — the selection rule this note replaces; its close-protection ownership and one-guide-per-pane rules remain active.
- [Sidebar and preview interaction polish](2026-09-09-sidebar-and-preview-interaction-polish.md) — lazy seeding on expansion, unchanged.
- [Sidebar text preview and file tree](2026-09-05-sidebar-text-preview-and-file-tree.md) — the page-type template this rule selects among.
- [Web sidebar terminals](2026-09-09-web-sidebar-terminal.md) — the tab that contributed the second door.
