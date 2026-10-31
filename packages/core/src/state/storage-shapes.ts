/**
 * Storage shape of a block written into the registry, decided by the COMPONENT
 * registry (`BlockKindResolver.getStorageShape`), never by the snapshot's child count:
 * an empty childless host container (an `aside` with no children yet) is still a flow
 * holder, so content can later be moved into it.
 *
 * A doc's resolver is bound once, by `createState` (where it is a required argument),
 * and every writer that creates a registry entry reads it here — so no state can be
 * written without one. Readers stay resolver-free: the shape persists in the entry.
 * The upgrade binds a resolver that INFERS the shape of a legacy type the host no
 * longer registers (inline content → text, children → container, else atomic) and
 * reports it; everywhere else an unregistered type is an error.
 */
import type * as Y from "yjs";
import type { BlockKindResolver } from "./block-kinds";
import type { BlockShape } from "./registry";

/** What a writer knows about the node it stores. */
export interface ShapeProbe {
  readonly type: string;
  readonly inline: boolean;
  readonly hasChildren: boolean;
}

interface Binding {
  readonly resolver: BlockKindResolver;
  /** Upgrade only: infer an unregistered type's shape (and record it) instead of failing. */
  readonly infer?: (probe: ShapeProbe) => BlockShape;
}

const bindings = new WeakMap<Y.Doc, Binding>();

/** Bind `resolver` as `doc`'s storage-shape authority (latest binding wins). */
export function bindStorageResolver(doc: Y.Doc, resolver: BlockKindResolver): void {
  bindings.set(doc, { resolver });
}

/** The resolver bound to `doc`. Throws when none is (a doc no `createState` bound). */
export function storageResolverOf(doc: Y.Doc): BlockKindResolver {
  const b = bindings.get(doc);
  if (b === undefined) throw new Error("storage: no BlockKindResolver bound to this document (create its Document with `resolver`)");
  return b.resolver;
}

/**
 * Run `fn` with `resolver` bound and unregistered types INFERRED from the node (the
 * upgrade of legacy types a host no longer registers); each inferred type is passed to
 * `onInferred`. The previous binding is restored afterwards.
 */
export function withInferringResolver<T>(doc: Y.Doc, resolver: BlockKindResolver, onInferred: (type: string) => void, fn: () => T): T {
  const prev = bindings.get(doc);
  bindings.set(doc, {
    resolver,
    infer: (p) => {
      onInferred(p.type);
      return p.inline ? "text" : p.hasChildren ? "container" : "atomic";
    },
  });
  try {
    return fn();
  } finally {
    if (prev === undefined) bindings.set(doc, { resolver });
    else bindings.set(doc, prev);
  }
}

/** The storage shape for a node of `probe.type` written into `doc`. Throws for an unregistered type. */
export function storageShapeFor(doc: Y.Doc, probe: ShapeProbe): BlockShape {
  const b = bindings.get(doc);
  if (b === undefined) throw new Error(`storage: no BlockKindResolver bound — cannot store a "${probe.type}" block`);
  const shape = b.resolver.getStorageShape(probe.type);
  if (shape !== null) return shape;
  if (b.infer !== undefined) return b.infer(probe);
  throw new Error(`storage: block type "${probe.type}" is not registered`);
}
