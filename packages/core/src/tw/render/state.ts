import { IComponentService } from '../component/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IModelNode } from '../model/node';
import { IModelService } from '../model/service';
import { IDidTransformModelStateEvent } from '../model/state';
import { IRenderDoc } from './doc';
import { IRenderNode } from './node';

export interface IDidUpdateRenderStateEvent {}

export interface IRenderState {
    onDidUpdateRenderState: IOnEvent<IDidUpdateRenderStateEvent>;
    readonly doc: IRenderDoc<any, any>;
}

export class RenderState implements IRenderState {
    readonly doc: IRenderDoc<any, any>;

    protected didUpdateRenderStateEventEmitter = new EventEmitter<IDidUpdateRenderStateEvent>();

    constructor(protected componentService: IComponentService, protected modelService: IModelService) {
        const modelRoot = modelService.getRoot();
        this.doc = this.updateNode(null, modelRoot) as IRenderDoc<any, any>;
        modelService.onDidTransformModelState(this.handleDidTransformModelStateEvent);
    }

    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>) {
        return this.didUpdateRenderStateEventEmitter.on(listener);
    }

    protected handleDidTransformModelStateEvent = (event: IDidTransformModelStateEvent) => {
        const modelRoot = this.modelService.getRoot();
        this.updateNode(this.doc, modelRoot);
        this.didUpdateRenderStateEventEmitter.emit({});
    };

    protected updateNode(node: IRenderNode<any, any> | null, modelNode: IModelNode<any>): IRenderNode<any, any> {
        if (!modelNode.needRender) {
            if (!node) {
                throw new Error('Expected node to be available.');
            }
            return node;
        }
        const childrenMap: { [key: string]: IRenderNode<any, any> } = {};
        if (node) {
            node.children.forEach((child) => {
                if (!child.modelId) {
                    return;
                }
                childrenMap[child.modelId] = child;
            });
        }
        const newChildren: IRenderNode<any, any>[] = [];
        modelNode.children.forEach((modelChild) => {
            newChildren.push(this.updateNode(childrenMap[modelChild.id] || null, modelChild));
        });
        modelNode.clearNeedRender();
        return this.buildNode(modelNode, newChildren);
    }

    protected buildNode(modelNode: IModelNode<any>, children: IRenderNode<any, any>[]) {
        const component = this.componentService.getComponent(modelNode.componentId);
        const node = component.buildRenderNode(
            modelNode.partId,
            modelNode.id,
            modelNode.text,
            modelNode.attributes,
            children,
        );
        if (!node) {
            throw new Error(`Error building render node from model node ${modelNode.id}.`);
        }
        return node;
    }
}
