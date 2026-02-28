import type { StateNode } from "./state-node";
import { createNode, createTextNode } from "./create-node";

/**
 * Create the minimum valid document: a document root with one empty paragraph
 * containing one empty text node.
 */
export function createEmptyDocument(): StateNode {
  const text = createTextNode("text-0", "");
  const paragraph = createNode("paragraph-0", "paragraph", {}, [text]);
  return createNode("document", "document", {}, [paragraph]);
}
