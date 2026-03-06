import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { splitNode } from "../../state/transformations";
import { createNode, createTextNode } from "../../state/create-node";
import { normalizeDocument } from "../../state/normalize";
import { rebuildTrees, deleteSelectionRange, findFirstTextDescendant, isEmptyParagraph } from "./helpers";

function buildBlock(
  blockType: string,
  properties: Record<string, unknown>,
  config: EditorConfig,
  containerWidth: number,
  allocateId: () => string,
): { block: ReturnType<typeof createNode>; hasChildren: boolean } {
  const component = config.registry.get(blockType);
  if (component?.createInitialState) {
    // Resolve default columnWidths for table if not provided
    const resolvedProps = { ...properties };
    if (blockType === "table" && !resolvedProps.columnWidths) {
      const columns = (resolvedProps.columns as number) ?? 1;
      resolvedProps.columnWidths = Array.from(
        { length: columns },
        () => 1 / columns,
      );
    }
    const block = component.createInitialState(allocateId(), resolvedProps, allocateId);
    return { block, hasChildren: block.children.length > 0 };
  }

  const block = createNode(allocateId(), blockType, properties, []);
  return { block, hasChildren: false };
}

/**
 * Find the index of a block in the normalized document by its id.
 * Returns -1 if not found.
 */
function findBlockIndex(doc: ReturnType<typeof createNode>, blockId: string): number {
  return doc.children.findIndex(c => c.id === blockId);
}

export function handleInsertBlock(
  editor: EditorState,
  blockType: string,
  properties: Record<string, unknown>,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, delete selection first
  let current = editor;
  if (!isCollapsed(editor.selection)) {
    current = deleteSelectionRange(editor, config);
  }

  const pos = current.selection.focus;
  const paraIdx = pos.path[0];
  const topBlock = current.state.children[paraIdx];

  // Build an allocateId closure wrapping nextId
  let nextIdCounter = current.nextId;
  const allocateId = () => {
    const id = `node-${nextIdCounter}`;
    nextIdCounter++;
    return id;
  };

  // Replace empty top-level paragraph instead of splitting
  if (topBlock && isEmptyParagraph(topBlock)) {
    const { block, hasChildren } = buildBlock(
      blockType, properties, config, current.containerWidth, allocateId,
    );

    const emptyText = createTextNode(allocateId(), "");
    const emptyPara = createNode(allocateId(), "paragraph", {}, [emptyText]);

    const docChildren = [...current.state.children];
    docChildren.splice(paraIdx, 1, block, emptyPara);

    let newDoc = createNode(
      current.state.id,
      current.state.type,
      { ...current.state.properties },
      docChildren,
    );

    // Normalize: ensure paragraphs between adjacent opaque blocks
    newDoc = normalizeDocument(newDoc, allocateId);

    // Compute cursor AFTER normalization
    const blockIdx = findBlockIndex(newDoc, block.id);
    let newSelection;
    if (hasChildren) {
      const blockInDoc = newDoc.children[blockIdx];
      const firstText = findFirstTextDescendant(blockInDoc, [blockIdx]);
      newSelection = firstText
        ? createCursor(firstText.path, 0)
        : createCursor([blockIdx + 1, 0], 0);
    } else {
      // Cursor goes to the paragraph after the block
      const afterBlock = newDoc.children[blockIdx + 1];
      const firstText = afterBlock ? findFirstTextDescendant(afterBlock, [blockIdx + 1]) : null;
      newSelection = firstText
        ? createCursor(firstText.path, 0)
        : createCursor([blockIdx + 1, 0], 0);
    }

    return rebuildTrees(
      {
        ...current,
        state: newDoc,
        selection: newSelection,
        history: pushEditorChange(current.history, {
          change: { oldState: current.state, newState: newDoc, timestamp: 0 },
          selectionBefore: editor.selection,
          selectionAfter: newSelection,
        }),
        nextId: nextIdCounter,
      },
      current,
      config,
    );
  }

  // Split the current paragraph at cursor
  const nodeId = allocateId();
  const change = splitNode(current.state, pos, nodeId, 0);

  const { block, hasChildren } = buildBlock(
    blockType, properties, config, current.containerWidth, allocateId,
  );

  // Insert the block between the two split halves
  const docChildren = [...change.newState.children];
  docChildren.splice(paraIdx + 1, 0, block);

  let newDoc = createNode(
    change.newState.id,
    change.newState.type,
    { ...change.newState.properties },
    docChildren,
  );

  // Normalize: ensure paragraphs between adjacent opaque blocks
  newDoc = normalizeDocument(newDoc, allocateId);

  // Cursor placement AFTER normalization
  const blockIdx = findBlockIndex(newDoc, block.id);
  let newSelection;
  if (hasChildren) {
    const blockInDoc = newDoc.children[blockIdx];
    const firstText = findFirstTextDescendant(blockInDoc, [blockIdx]);
    newSelection = firstText
      ? createCursor(firstText.path, 0)
      : createCursor([blockIdx + 1, 0, 0, 0, 0], 0);
  } else {
    const afterBlock = newDoc.children[blockIdx + 1];
    const firstText = afterBlock ? findFirstTextDescendant(afterBlock, [blockIdx + 1]) : null;
    newSelection = firstText
      ? createCursor(firstText.path, 0)
      : createCursor([blockIdx + 1, 0], 0);
  }

  return rebuildTrees(
    {
      ...current,
      state: newDoc,
      selection: newSelection,
      history: pushEditorChange(current.history, {
        change: { oldState: current.state, newState: newDoc, timestamp: 0 },
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
      nextId: nextIdCounter,
    },
    current,
    config,
  );
}
