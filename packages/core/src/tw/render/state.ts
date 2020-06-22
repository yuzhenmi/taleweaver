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
    protected didUpdateRenderStateEventEmitter = new EventEmitter<IDidUpdateRenderStateEvent>();
    protected internalDoc: IRenderDoc<any, any>;

    constructor(protected componentService: IComponentService, protected modelService: IModelService) {
        const modelRoot = modelService.getRoot();
        this.internalDoc = this.updateNode(null, modelRoot) as IRenderDoc<any, any>;
        modelService.onDidUpdateModelState((event) => this.handleDidUpdateModelState(event));
    }

    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>) {
        return this.didUpdateRenderStateEventEmitter.on(listener);
    }

    get doc() {
        return this.internalDoc;
    }

    protected handleDidUpdateModelState(event: IDidUpdateModelStateEvent) {
        this.update();
    }

    protected update() {
        const modelRoot = this.modelService.getRoot();
        this.internalDoc = this.updateNode(this.doc, modelRoot) as IRenderDoc<any, any>;
        this.didUpdateRenderStateEventEmitter.emit({});
    }

    protected updateNode(node: IRenderNode<any, any> | null, modelNode: IModelNode<any>): IRenderNode<any, any> {
        if (!modelNode.needRender && node) {
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
