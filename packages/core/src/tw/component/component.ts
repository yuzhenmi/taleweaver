import { IModelNode } from 'tw/model/node';
import { IRenderNode } from 'tw/render/node';
import { IAttributes } from 'tw/state/token';

export interface IComponent {
    getId(): string;
    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes): IModelNode<IAttributes>;
    buildRenderNode(modelNode: IModelNode): IRenderNode;
}

export abstract class Component {
    constructor(protected id: string) {}

    getId() {
        return this.id;
    }
}
