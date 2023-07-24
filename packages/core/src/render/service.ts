import { ComponentService } from '../component/service';
import { EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';
import { ModelNode } from '../model/node';
import { DidUpdateModelTreeEvent, ModelService } from '../model/service';
import { RenderNode } from './nodes';
import { DocRenderNode } from './nodes/doc';
import { TextRenderNode } from './nodes/text';

export interface DidUpdateRenderTreeEvent {}

export class RenderService implements RenderService {
    protected internalDoc: DocRenderNode;
    protected didUpdateRenderTreeEventEmitter = new EventEmitter<DidUpdateRenderTreeEvent>();

    constructor(protected modelService: ModelService, protected componentService: ComponentService) {
        modelService.onDidUpdateModelTreeState(this.handleDidUpdateModelTree);
        const doc = this.updateFromModel(modelService.root);
        if (doc.type !== 'doc') {
            throw new Error('Invalid root in the model tree.');
        }
        this.internalDoc = doc;
    }

    get doc() {
        return this.internalDoc;
    }

    onDidUpdateRenderTree(listener: EventListener<DidUpdateRenderTreeEvent>) {
        return this.didUpdateRenderTreeEventEmitter.on(listener);
    }

    protected updateFromModel(modelNode: ModelNode<unknown>, node?: RenderNode) {
        if (!modelNode.needRender && node) {
            return node;
        }
        const currentChildrenLookup = new Map<string, RenderNode>();
        if (node && node.type !== 'text') {
            for (const child of node.children) {
                currentChildrenLookup.set(child.id, child);
            }
        }
        const updatedChildren: RenderNode[] = [];
        let textCounter = 1;
        let text = '';
        for (const modelChild of modelNode.children) {
            if (typeof modelChild === 'string') {
                text += modelChild;
                continue;
            }
            if (text) {
                updatedChildren.push(this.createTextNodes(text, textCounter));
                textCounter++;
            }
            const component = this.componentService.getComponent(modelChild.componentId);
            const id = component(modelChild.id, modelChild.props, []).id;
            const child = currentChildrenLookup.get(id);
            updatedChildren.push(this.updateFromModel(modelChild, child));
        }
        if (text) {
            updatedChildren.push(this.createTextNodes(text, textCounter));
        }
        const component = this.componentService.getComponent(modelNode.componentId);
        return component(modelNode.id, modelNode.props, updatedChildren);
    }

    protected createTextNodes(text: string, counter: number) {
        return new TextRenderNode(
            `text-${counter}`,
            {
                weight: 400,
                size: 16,
                family: 'sans-serif',
                letterSpacing: 0,
                underline: false,
                italic: false,
                strikethrough: false,
                color: 'black',
            },
            text,
        );
    }

    protected handleDidUpdateModelTree = (event: DidUpdateModelTreeEvent) => {
        const doc = this.updateFromModel(this.modelService.root, this.internalDoc);
        if (doc.type !== 'doc') {
            throw new Error('Invalid root in the model tree.');
        }
        this.internalDoc = doc;
        this.didUpdateRenderTreeEventEmitter.emit({});
    };
}
