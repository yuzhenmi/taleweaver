import { DocComponent, DocModelNode } from 'tw/component/components/doc';
import { ParagraphComponent, ParagraphModelNode } from 'tw/component/components/paragraph';
import { TextComponent, TextModelNode, WordRenderNode } from 'tw/component/components/text';
import { ComponentService } from 'tw/component/service';
import { ConfigService } from 'tw/config/service';
import { EventEmitter, IEventEmitter } from 'tw/event/emitter';
import { IEventListener } from 'tw/event/listener';
import { IDocModelNode } from 'tw/model/doc-node';
import { IModelPosition } from 'tw/model/node';
import { IModelService } from 'tw/model/service';
import { IDidUpdateModelStateEvent } from 'tw/model/state';
import { IInlineRenderNode } from './inline-node';
import { RenderState } from './state';

class MockModelService implements IModelService {
    protected didUpdateModelStateEventEmitter: IEventEmitter<IDidUpdateModelStateEvent> = new EventEmitter();

    constructor(protected docNode: IDocModelNode) {}

    setDocNode(docNode: IDocModelNode) {
        this.docNode = docNode;
    }

    emitDidUpdateModelStateEvent(event: IDidUpdateModelStateEvent) {
        this.didUpdateModelStateEventEmitter.emit(event);
    }

    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>) {
        this.didUpdateModelStateEventEmitter.on(listener);
    }

    getDocNode() {
        return this.docNode;
    }

    toHTML(from: number, to: number): string {
        throw new Error('Not implemented.');
    }

    resolvePosition(offset: number): IModelPosition {
        throw new Error('Not implemented.');
    }
}

describe('ModelState', () => {
    let docComponent: DocComponent;
    let paragraphComponent: ParagraphComponent;
    let textComponent: TextComponent;
    let configService: ConfigService;
    let componentService: ComponentService;
    let modelService: MockModelService;
    let renderState: RenderState;

    beforeEach(() => {
        docComponent = new DocComponent('doc');
        paragraphComponent = new ParagraphComponent('paragraph');
        textComponent = new TextComponent('text');
        configService = new ConfigService(
            {
                commands: {},
                components: {
                    doc: docComponent,
                    paragraph: paragraphComponent,
                    text: textComponent,
                },
            },
            {},
        );
        componentService = new ComponentService(configService);
        const docModelNode = new DocModelNode(docComponent, 'doc', {});
        const paragraphModelNode = new ParagraphModelNode(paragraphComponent, '1', {});
        docModelNode.setChildren([paragraphModelNode]);
        const textModelNode1 = new TextModelNode(textComponent, '2', {});
        textModelNode1.setContent('Hello');
        const textModelNode2 = new TextModelNode(textComponent, '3', { bold: true });
        textModelNode2.setContent('world');
        paragraphModelNode.setChildren([textModelNode1, textModelNode2]);
        modelService = new MockModelService(docModelNode);
        renderState = new RenderState(componentService, modelService);
    });

    it('initializes render tree from model state', () => {
        const docNode = renderState.getDocNode();
        expect(docNode.getComponentId()).toEqual('doc');
        expect(docNode.getId()).toEqual('doc');
        expect(docNode.getChildren()).toHaveLength(1);
        const blockNode = docNode.getFirstChild()!;
        expect(blockNode.getComponentId()).toEqual('paragraph');
        expect(blockNode.getId()).toEqual('1');
        expect(blockNode.getChildren()).toHaveLength(3);
        const inlineNode1 = blockNode.getFirstChild()!;
        expect(inlineNode1.getComponentId()).toEqual('text');
        expect(inlineNode1.getId()).toEqual('2');
        expect(inlineNode1.getChildren()).toHaveLength(1);
        const inlineNode2 = inlineNode1.getNextSibling()! as IInlineRenderNode;
        expect(inlineNode2.getComponentId()).toEqual('text');
        expect(inlineNode2.getId()).toEqual('3');
        expect(inlineNode2.getChildren()).toHaveLength(1);
    });

    describe('when model state did update', () => {
        it('updates render tree', () => {
            const textModelNode1 = new TextModelNode(textComponent, '2', {});
            textModelNode1.setContent(' Hello');
            modelService.emitDidUpdateModelStateEvent({
                updatedNode: textModelNode1,
            });
            const docNode = renderState.getDocNode();
            expect(docNode.getChildren()).toHaveLength(1);
            const blockNode = docNode.getFirstChild()!;
            expect(blockNode.getChildren()).toHaveLength(3);
            const inlineNode = blockNode.getFirstChild()!;
            expect(inlineNode.getChildren()).toHaveLength(2);
            const atomicNode1 = inlineNode.getFirstChild() as WordRenderNode;
            expect(atomicNode1.getContent()).toEqual(' ');
            const atomicNode2 = atomicNode1.getNextSibling() as WordRenderNode;
            expect(atomicNode2.getContent()).toEqual('Hello');
        });
    });
});