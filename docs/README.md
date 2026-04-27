# Taleweaver Architecture & Issues

This directory contains a study of the Taleweaver codebase. It is split into two
parts: an architectural reference designed to be read alongside the code, and a
catalog of identified issues with concrete fix paths.

All file paths in these documents are relative to the repository root unless
stated otherwise. Line references refer to the state of the codebase at the
time these docs were written.

## Features

[features.md](features.md) — exhaustive enumeration of what the engine
does today (and what it doesn't). Grouped by domain: document model,
state operations, editor actions, keyboard shortcuts, mouse, clipboard,
IME, cursor / caret, layout, rendering, pagination, focus, history,
React integration, configuration, examples, and a long list of known
absent features.

## Architecture

Read in order for a full top-down tour. Each doc stands on its own.

| # | File | Topic |
|---|------|-------|
| 00 | [overview](architecture/00-overview.md) | Package layout, dependency graph, the 3-tree pipeline |
| 01 | [state layer](architecture/01-state-layer.md) | Immutable state tree, positions, transformations, history |
| 02 | [components](architecture/02-components.md) | Component definition, registry, the 12 default components |
| 03 | [render layer](architecture/03-render-layer.md) | Render tree, `RenderStyles`, incremental render |
| 04 | [layout layer](architecture/04-layout-layer.md) | Layout boxes, line wrapping, pagination, text measurement |
| 05 | [editor reducer](architecture/05-editor-reducer.md) | `EditorState`, `EditorAction`, `reduceEditor`, action handlers |
| 06 | [cursor & selection](architecture/06-cursor-selection.md) | `Selection`, navigation, hit-testing, geometry |
| 07 | [DOM controller](architecture/07-dom-controller.md) | Canvas painting, key/mouse/clipboard, paginated canvas pool |
| 08 | [React bindings](architecture/08-react-bindings.md) | `useEditor`, `<EditorView>` |
| 09 | [data flow](architecture/09-data-flow.md) | End-to-end keystroke trace, where each tree is rebuilt |

## Issues

Each issue is a self-contained file: location in code, why it's a problem,
fix options with tradeoffs, migration plan, test impact. Severities are
**Major** (will block project goals), **Significant** (technical debt that
will compound), and **Minor** (smells / future-proofing).

| # | File | Severity |
|---|------|----------|
| 01 | [components-no-behavior-hooks](issues/01-components-no-behavior-hooks.md) | Major |
| 02 | [untyped-properties-schema](issues/02-untyped-properties-schema.md) | Major |
| 03 | [inline-layout-not-incremental](issues/03-inline-layout-not-incremental.md) | Major |
| 04 | [pagination-whole-block-only](issues/04-pagination-whole-block-only.md) | Major |
| 05 | [editor-state-mixed-concerns](issues/05-editor-state-mixed-concerns.md) | Significant |
| 06 | [duplicate-history-systems](issues/06-duplicate-history-systems.md) | Significant |
| 07 | [monolithic-reducer-switch](issues/07-monolithic-reducer-switch.md) | Significant |
| 08 | [editor-controller-srp](issues/08-editor-controller-srp.md) | Significant |
| 09 | [three-level-naming](issues/09-three-level-naming.md) | Minor |
| 10 | [duplicate-magic-constants](issues/10-duplicate-magic-constants.md) | Minor |
| 11 | [no-collaboration-architecture](issues/11-no-collaboration-architecture.md) | Minor |
| 12 | [accessibility-gap](issues/12-accessibility-gap.md) | Minor |
| 13 | [long-document-virtualization](issues/13-long-document-virtualization.md) | Minor |
