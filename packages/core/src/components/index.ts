import type { ComponentDefinition } from "./component-definition";
import { documentComponent } from "./document";
import { paragraphComponent } from "./paragraph";
import { textComponent } from "./text";
import { headingComponent } from "./heading";
// Plan 2 will migrate these components to the new render pipeline:
// import { spanComponent } from "./span";
// import { listComponent } from "./list";
// import { listItemComponent } from "./list-item";
// import { imageComponent } from "./image";
// import { horizontalLineComponent } from "./horizontal-line";
// import { tableComponent } from "./table";
// import { tableRowComponent } from "./table-row";
// import { tableCellComponent } from "./table-cell";

export type { ComponentRenderFn, ComponentDefinition } from "./component-definition";
export { documentComponent } from "./document";
export { paragraphComponent } from "./paragraph";
export { textComponent } from "./text";
export { headingComponent } from "./heading";
// Plan 2 will re-export these once migrated:
// export { spanComponent } from "./span";
// export { listComponent } from "./list";
// export { listItemComponent } from "./list-item";
// export { imageComponent } from "./image";
// export { horizontalLineComponent } from "./horizontal-line";
// export { tableComponent } from "./table";
// export { tableRowComponent } from "./table-row";
// export { tableCellComponent } from "./table-cell";

export { ComponentRegistry, createRegistry } from "./component-registry";

/** All default component definitions (Plan 1: migrated components only). */
export const defaultComponents: readonly ComponentDefinition[] = [
  documentComponent,
  paragraphComponent,
  textComponent,
  headingComponent,
];
