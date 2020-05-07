import { ILayoutNode } from '../layout/node';
import { IModelNode } from '../model/node';
import { IRenderNode } from '../render/node';
import { IViewNode } from '../view/node';

export interface IComponent {
    readonly id: string;

    buildModelNode(
        partId: string | null,
        id: string,
        attributes: {},
        children: IModelNode<any>[],
        text: string,
    ): IModelNode<any> | undefined;
    buildRenderNode(modelNode: IModelNode<any>, children: IRenderNode<any>[]): IRenderNode<any> | undefined;
    buildLayoutNode(renderNode: IRenderNode<any>): ILayoutNode | undefined;
    buildViewNode(layoutNode: ILayoutNode): IViewNode | undefined;
}

export abstract class Component implements IComponent {
    abstract buildModelNode(
        partId: string | null,
        id: string,
        attributes: {},
        children: IModelNode<any>[],
        text: string,
    ): IModelNode<any> | undefined;
    abstract buildRenderNode(modelNode: IModelNode<any>, children: IRenderNode<any>[]): IRenderNode<any> | undefined;
    abstract buildLayoutNode(renderNode: IRenderNode<any>): ILayoutNode | undefined;
    abstract buildViewNode(layoutNode: ILayoutNode): IViewNode | undefined;

    constructor(readonly id: string) {}
}
