import { ILayoutNode } from '../layout/node';
import { IModelNode } from '../model/node';
import { IRenderNode } from '../render/node';
import { IViewNode } from '../view/node';

export interface IComponent {
    getId(): string;
    buildModelNode(partId: string | null, id: string, attributes: {}, text: string): IModelNode<any> | undefined;
    buildRenderNode(modelNode: IModelNode<any>): IRenderNode | undefined;
    buildLayoutNode(renderNode: IRenderNode): ILayoutNode | undefined;
    buildViewNode(layoutNode: ILayoutNode): IViewNode | undefined;
}

export abstract class Component implements IComponent {
    abstract buildModelNode(
        partId: string | undefined,
        id: string,
        attributes: IAttributes,
    ): IModelNode<IAttributes> | undefined;
    abstract buildRenderNode(modelNode: IModelNode): IRenderNode | undefined;
    abstract buildLayoutNode(renderNode: IRenderNode): ILayoutNode | undefined;
    abstract buildViewNode(layoutNode: ILayoutNode): IViewNode | undefined;

    constructor(protected id: string) {}

    getId() {
        return this.id;
    }
}
