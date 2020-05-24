import { IModelNode } from '../model/node';
import { IRenderNode } from '../render/node';
import { IViewNode } from '../view/node';

export interface IComponent {
    readonly id: string;

    buildModelNode(partId: string | null, id: string, text: string, attributes: {}): IModelNode<any> | undefined;
    buildRenderNode(
        partId: string | null,
        modelId: string,
        text: string,
        attributes: any,
        children: IRenderNode<any, any>[],
    ): IRenderNode<any, any> | undefined;
    buildViewNode(
        partId: string | null,
        renderId: string,
        layoutId: string,
        text: string,
        style: any,
    ): IViewNode<any> | undefined;
}

export abstract class Component implements IComponent {
    abstract buildModelNode(
        partId: string | null,
        id: string,
        text: string,
        attributes: any,
    ): IModelNode<any> | undefined;
    abstract buildRenderNode(
        partId: string | null,
        modelId: string,
        text: string,
        attributes: any,
        children: IRenderNode<any, any>[],
    ): IRenderNode<any, any> | undefined;
    abstract buildViewNode(
        partId: string | null,
        renderId: string,
        layoutId: string,
        text: string,
        style: any,
    ): IViewNode<any> | undefined;

    constructor(readonly id: string) {}
}
