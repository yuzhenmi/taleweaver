import type { DocumentSerializer } from "./document-serializer";
import { createBinaryDocumentSerializer } from "./binary-serializer";

/**
 * Registry of document serializers, keyed by `serializer.format`. Mirrors the
 * component/attribute registries: a small interface over a `Map`, with two
 * factories (empty / default-populated). Constructor-injectable into the engine
 * dispatch (`serializeDocument` / `deserializeDocument`); tests use the empty
 * registry to isolate behavior.
 */
export interface SerializerRegistry {
  register(serializer: DocumentSerializer): void;
  get(format: string): DocumentSerializer | undefined;
  has(format: string): boolean;
}

class SerializerRegistryImpl implements SerializerRegistry {
  private readonly serializers = new Map<string, DocumentSerializer>();

  register(serializer: DocumentSerializer): void {
    this.serializers.set(serializer.format, serializer);
  }
  get(format: string): DocumentSerializer | undefined {
    return this.serializers.get(format);
  }
  has(format: string): boolean {
    return this.serializers.has(format);
  }
}

/** An empty registry; tests register only the serializers under test. */
export function createSerializerRegistry(): SerializerRegistry {
  return new SerializerRegistryImpl();
}

/**
 * A registry pre-populated with the built-in serializers. Contains ONLY the v1
 * Yjs-binary serializer (`createBinaryDocumentSerializer`) — the one serializer
 * with no host-supplied dependencies. It stays arg-free.
 *
 * The human-friendly serializers (`createJsonDocumentSerializer`, and the HTML
 * serializer) are NOT default-registered: they need host-supplied dependencies
 * (a `blockKindResolver` — the component registry — and an `IdAllocator`).
 * Default-registering them would invert the `components → state` layering, so
 * they are HOST-registered (the host constructs them with its registry and
 * `register`s them onto this registry).
 */
export function createDefaultSerializerRegistry(): SerializerRegistry {
  const reg = createSerializerRegistry();
  reg.register(createBinaryDocumentSerializer());
  return reg;
}
