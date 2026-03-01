export type { ComponentRenderFn, ComponentDefinition } from "./component-definition";
export { documentComponent } from "./document";
export { paragraphComponent } from "./paragraph";
export { textComponent } from "./text";
export { spanComponent } from "./span";
export { headingComponent } from "./heading";
export { listComponent } from "./list";
export { listItemComponent } from "./list-item";

export { ComponentRegistry, createRegistry } from "./component-registry";

import type { ComponentDefinition } from "./component-definition";
import { documentComponent } from "./document";
import { paragraphComponent } from "./paragraph";
import { textComponent } from "./text";
import { spanComponent } from "./span";
import { headingComponent } from "./heading";
import { listComponent } from "./list";
import { listItemComponent } from "./list-item";

/** All default component definitions. */
export const defaultComponents: readonly ComponentDefinition[] = [
  documentComponent,
  paragraphComponent,
  textComponent,
  spanComponent,
  headingComponent,
  listComponent,
  listItemComponent,
];
