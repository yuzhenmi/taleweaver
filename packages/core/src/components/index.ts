// Components barrel for the new (post-cutover) render pipeline.
// Each component is a frozen ComponentDefinition keyed by its `type`.

export type { ComponentDefinition } from "./component-definition";
export type { ComponentRegistry } from "./component-registry";
export {
  createComponentRegistry,
  createDefaultComponentRegistry,
} from "./component-registry";

export { documentComponent } from "./document";
export { templateBodyComponent } from "./template-body";
export { footnoteBodyComponent } from "./footnote-body";
export { paragraphComponent } from "./paragraph";
export { headingComponent } from "./heading";
export { listItemComponent } from "./list-item";
export { tableComponent } from "./table";
export { tableRowComponent } from "./table-row";
export { tableCellComponent } from "./table-cell";
export { imageComponent } from "./image";
export { horizontalLineComponent } from "./horizontal-line";
export { tableOfContentsComponent } from "./table-of-contents";
