import type { ComponentDefinition } from "./component-definition-legacy";
import { documentComponent } from "./document-legacy";
import { paragraphComponent } from "./paragraph-legacy";
import { textComponent } from "./text-legacy";
import { headingComponent } from "./heading-legacy";
import { spanComponent } from "./span-legacy";
import { listComponent } from "./list-legacy";
import { listItemComponent } from "./list-item-legacy";
import { imageComponent } from "./image-legacy";
import { horizontalLineComponent } from "./horizontal-line-legacy";
import { tableComponent } from "./table-legacy";
import { tableRowComponent } from "./table-row-legacy";
import { tableCellComponent } from "./table-cell-legacy";

export type { ComponentRenderFn, ComponentDefinition } from "./component-definition-legacy";
export { documentComponent } from "./document-legacy";
export { paragraphComponent } from "./paragraph-legacy";
export { textComponent } from "./text-legacy";
export { headingComponent } from "./heading-legacy";
export { spanComponent } from "./span-legacy";
export { listComponent } from "./list-legacy";
export { listItemComponent } from "./list-item-legacy";
export { imageComponent } from "./image-legacy";
export { horizontalLineComponent } from "./horizontal-line-legacy";
export { tableComponent } from "./table-legacy";
export { tableRowComponent } from "./table-row-legacy";
export { tableCellComponent } from "./table-cell-legacy";

export { ComponentRegistry, createRegistry } from "./component-registry-legacy";

/** All default component definitions (Plan 1 stubs for all node types). */
export const defaultComponents: readonly ComponentDefinition[] = [
  documentComponent,
  paragraphComponent,
  textComponent,
  headingComponent,
  spanComponent,
  listComponent,
  listItemComponent,
  imageComponent,
  horizontalLineComponent,
  tableComponent,
  tableRowComponent,
  tableCellComponent,
];

export {
  createParagraph,
  createHeading,
  createText,
  createList,
  createListItem,
  createTable,
  createImage,
  createHorizontalLine,
} from "./factories-legacy";
