import { IComponentService } from '../component/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IModelNode } from '../model/node';
import { IModelService } from '../model/service';
import { IDidUpdateModelStateEvent } from '../model/state';
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
        this.doc = this.buildNode(modelRoot) as IRenderDoc<any, any>;
        this.updateNode(this.doc, modelRoot);
        modelService.onDidUpdateModelState(this.handleDidUpdateModelStateEvent);
    }

    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>) {
        return this.didUpdateRenderStateEventEmitter.on(listener);
    }

    protected handleDidUpdateModelStateEvent = (event: IDidUpdateModelStateEvent) => {
        const modelRoot = this.modelService.getRoot();
        this.updateNode(this.doc, modelRoot);
        this.didUpdateRenderStateEventEmitter.emit({});
    };

    protected updateNode(node: IRenderNode<any, any>, modelNode: IModelNode<any>) {
        node.update(modelNode.text, modelNode.attributes);
        const childrenMap: { [key: string]: IRenderNode<any, any> } = {};
        node.children.forEach((child) => {
            if (!child.modelId) {
                return;
            }
            childrenMap[child.modelId] = child;
        });
        const newChildren: IRenderNode<any, any>[] = [];
        modelNode.children.forEach((modelChild) => {
            let child = childrenMap[modelChild.id];
            if (!child) {
                child = this.buildNode(modelChild);
            }
            newChildren.push(child);
            if (modelChild.needRender) {
                this.updateNode(child, modelChild);
            }
        });
        node.setChildren(newChildren);
        modelNode.clearNeedRender();
    }

    protected buildNode(modelNode: IModelNode<any>) {
        const component = this.componentService.getComponent(modelNode.componentId);
        const node = component.buildRenderNode(modelNode.partId, modelNode.id);
        if (!node) {
            throw new Error(`Error building render node from model node ${modelNode.id}.`);
        }
        return node;
    }
}
