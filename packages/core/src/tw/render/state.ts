import { IComponentService } from '../component/service';
import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IModelNode } from '../model/node';
import { IModelService } from '../model/service';
import { IDidUpdateModelStateEvent } from '../model/state';
import { IRenderDoc } from './doc';
import { IRenderNode } from './node';

export interface IDidUpdateRenderStateEvent {
    readonly node: IRenderNode<any>;
}

export interface IRenderState {
    onDidUpdateRenderState: IOnEvent<IDidUpdateRenderStateEvent>;
    readonly doc: IRenderDoc<any>;
}

export class RenderState implements IRenderState {
    readonly doc: IRenderDoc<any>;

    protected didUpdateRenderStateEventEmitter: IEventEmitter<IDidUpdateRenderStateEvent> = new EventEmitter();

    constructor(protected componentService: IComponentService, protected modelService: IModelService) {
        const modelDoc = modelService.getRoot();
        this.doc = this.buildNode(modelDoc);
        this.updateFromModel(this.doc, modelDoc);
        modelService.onDidUpdateModelState(this.handleDidUpdateModelStateEvent);
    }

    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>) {
        return this.didUpdateRenderStateEventEmitter.on(listener);
    }

    protected handleDidUpdateModelStateEvent = (event: IDidUpdateModelStateEvent) => {
        const modelDoc = this.modelService.getRoot();
        this.updateFromModel(this.doc, modelDoc);
    };

    protected updateFromModel(node: IRenderNode<any>, modelNode: IModelNode<any>) {
        if (!modelNode.needRender) {
            return;
        }
        node.updateFromModel(modelNode);
        const childrenMap = new Map<string, IRenderNode<any>>();
        node.children.forEach((child) => childrenMap.set(child.modelId, child));
        const newChildren: IRenderNode<any>[] = [];
        modelNode.children.forEach((modelChild) => {
            let child = childrenMap.get(modelChild.id);
            if (!child) {
                child = this.buildNode(modelChild);
            }
            newChildren.push(child);
        });
        node.setChildren(newChildren);
    }

    protected buildNode(modelNode: IModelNode<any>) {
        const component = this.componentService.getComponent(modelNode.componentId);
        if (!component) {
            throw new Error(`Component ${modelNode.componentId} is not registered.`);
        }
        const node = component.buildRenderNode(modelNode);
        if (!node) {
            throw new Error(`Error building render node from model node ${modelNode.id}.`);
        }
        return node;
    }
}
