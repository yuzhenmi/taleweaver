import { ILayoutNode } from '../layout/node';
import { IAttributes, IModelNode } from '../model/node';
import { IRenderNode } from '../render/node';
import { IViewNode } from '../view/node';

export interface IComponent {
    getId(): string;
    buildModelNode(
        partId: string | undefined,
        id: string,
        attributes: IAttributes,
    ): IModelNode<IAttributes> | undefined;
    buildRenderNode(modelNode: IModelNode): IRenderNode | undefined;
    buildLayoutNode(renderNode: IRenderNode): ILayoutNode | undefined;
    buildViewNode(layoutNode: ILayoutNode): IViewNode | undefined;
}

export abstract class Component {
    constructor(protected id: string) {}

    getId() {
        return this.id;
    }
}
