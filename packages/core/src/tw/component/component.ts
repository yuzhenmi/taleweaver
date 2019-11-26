import { ILayoutNode } from 'tw/layout/node';
import { IAttributes, IModelNode } from 'tw/model/node';
import { IRenderNode } from 'tw/render/node';

export interface IComponent {
    getId(): string;
    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes): IModelNode<IAttributes>;
    buildRenderNode(modelNode: IModelNode): IRenderNode;
    buildLayoutNode(renderNode: IRenderNode): ILayoutNode;
}

export abstract class Component {
    constructor(protected id: string) {}

    getId() {
        return this.id;
    }
}
