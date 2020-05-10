import { ILayoutNode } from '../layout/node';
import { IModelNode } from '../model/node';
import { IRenderNode } from '../render/node';
import { IViewNode } from '../view/node';

export interface IComponent {
    readonly id: string;

    buildModelNode(partId: string | null, id: string, attributes: {}, text: string): IModelNode<any> | undefined;
    buildRenderNode(partId: string | null, modelId: string): IRenderNode<any> | undefined;
    buildViewNode(layoutNode: ILayoutNode): IViewNode | undefined;
}

export abstract class Component implements IComponent {
    abstract buildModelNode(
        partId: string | null,
        id: string,
        attributes: {},
        text: string,
    ): IModelNode<any> | undefined;
    abstract buildRenderNode(partId: string | null, modelId: string): IRenderNode<any> | undefined;
    abstract buildViewNode(layoutNode: ILayoutNode): IViewNode | undefined;

    constructor(readonly id: string) {}
}
