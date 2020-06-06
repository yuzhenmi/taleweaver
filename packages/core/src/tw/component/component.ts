import { IModelNode } from '../model/node';
import { IRenderNode } from '../render/node';
import { IViewNode } from '../view/node';

export interface IComponent {
    readonly id: string;

    buildModelNode(
        partId: string | null,
        id: string,
        text: string,
        attributes: {},
        children: IModelNode<any>[],
    ): IModelNode<any>;
    buildRenderNode(
        partId: string | null,
        modelId: string,
        text: string,
        attributes: any,
        children: IRenderNode<any, any>[],
    ): IRenderNode<any, any>;
    buildViewNode(
        partId: string | null,
        renderId: string,
        layoutId: string,
        text: string,
        style: any,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ): IViewNode<any>;
}

export abstract class Component implements IComponent {
    abstract buildModelNode(
        partId: string | null,
        id: string,
        text: string,
        attributes: any,
        children: IModelNode<any>[],
    ): IModelNode<any>;
    abstract buildRenderNode(
        partId: string | null,
        modelId: string,
        text: string,
        attributes: any,
        children: IRenderNode<any, any>[],
    ): IRenderNode<any, any>;
    abstract buildViewNode(
        partId: string | null,
        renderId: string,
        layoutId: string,
        text: string,
        style: any,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ): IViewNode<any>;

    constructor(readonly id: string) {}
}
