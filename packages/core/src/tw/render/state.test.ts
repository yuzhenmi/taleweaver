import { DocComponent, DocModelNode } from '../component/components/doc';
import { ParagraphComponent, ParagraphModelNode } from '../component/components/paragraph';
import { TextComponent, TextModelNode, WordRenderNode } from '../component/components/text';
import { TextMeasurerStub } from '../component/components/text-measurer.stub';
import { ComponentService } from '../component/service';
import { buildStubConfig } from '../config/config.stub';
import { ConfigService } from '../config/service';
import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener } from '../event/listener';
import { IDocModelNode } from '../model/doc-node';
import { IModelPosition } from '../model/node';
import { IModelService } from '../model/service';
import { IDidUpdateModelStateEvent } from '../model/state';
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
    let textMeasurer: TextMeasurerStub;
    let docComponent: DocComponent;
    let paragraphComponent: ParagraphComponent;
    let textComponent: TextComponent;
    let configService: ConfigService;
    let componentService: ComponentService;
    let modelService: MockModelService;
    let renderState: RenderState;

    beforeEach(() => {
        const config = buildStubConfig();
        textMeasurer = new TextMeasurerStub();
        docComponent = new DocComponent('doc');
        paragraphComponent = new ParagraphComponent('paragraph');
        textComponent = new TextComponent('text', textMeasurer);
        config.components.doc = docComponent;
        config.components.paragraph = paragraphComponent;
        config.components.text = textComponent;
        configService = new ConfigService(config, {});
        componentService = new ComponentService(configService);
        const docModelNode = new DocModelNode('doc', 'doc', {});
        const paragraphModelNode = new ParagraphModelNode('paragraph', '1', {});
        docModelNode.appendChild(paragraphModelNode);
        const textModelNode1 = new TextModelNode('text', '2', {});
        textModelNode1.setContent('Hello');
        const textModelNode2 = new TextModelNode('text', '3', { bold: true });
        textModelNode2.setContent('world');
        paragraphModelNode.appendChild(textModelNode1);
        paragraphModelNode.appendChild(textModelNode2);
        modelService = new MockModelService(docModelNode);
        renderState = new RenderState(componentService, modelService);
    });

    it('initializes render tree from model state', () => {
        const docNode = renderState.getDocNode();
        expect(docNode.getComponentId()).toEqual('doc');
        expect(docNode.getPartId()).toEqual('doc');
        expect(docNode.getId()).toEqual('doc');
        expect(docNode.getChildren()).toHaveLength(1);
        const blockNode = docNode.getFirstChild()!;
        expect(blockNode.getComponentId()).toEqual('paragraph');
        expect(blockNode.getPartId()).toEqual('paragraph');
        expect(blockNode.getId()).toEqual('1');
        expect(blockNode.getChildren()).toHaveLength(3);
        const inlineNode1 = blockNode.getFirstChild()!;
        expect(inlineNode1.getComponentId()).toEqual('text');
        expect(inlineNode1.getPartId()).toEqual('text');
        expect(inlineNode1.getId()).toEqual('2');
        expect(inlineNode1.getChildren()).toHaveLength(1);
        const atomicNode1 = inlineNode1.getFirstChild()!;
        expect(atomicNode1.getComponentId()).toEqual('text');
        expect(atomicNode1.getPartId()).toEqual('word');
        expect(atomicNode1.getId()).toEqual('2-0');
        const inlineNode2 = inlineNode1.getNextSibling()! as IInlineRenderNode;
        expect(inlineNode2.getComponentId()).toEqual('text');
        expect(inlineNode2.getPartId()).toEqual('text');
        expect(inlineNode2.getId()).toEqual('3');
        expect(inlineNode2.getChildren()).toHaveLength(1);
        const atomicNode2 = inlineNode2.getFirstChild()!;
        expect(atomicNode2.getComponentId()).toEqual('text');
        expect(atomicNode2.getPartId()).toEqual('word');
        expect(atomicNode2.getId()).toEqual('3-0');
    });

    describe('when model state did update', () => {
        it('updates render tree', () => {
            const textModelNode1 = new TextModelNode('text', '2', {});
            textModelNode1.setContent(' Hello');
            modelService.emitDidUpdateModelStateEvent({
                node: textModelNode1,
            });
            const docNode = renderState.getDocNode();
            expect(docNode.getChildren()).toHaveLength(1);
            const blockNode = docNode.getFirstChild()!;
            expect(blockNode.getChildren()).toHaveLength(3);
            const inlineNode = blockNode.getFirstChild()!;
            expect(inlineNode.getChildren()).toHaveLength(2);
            const atomicNode1 = inlineNode.getFirstChild() as WordRenderNode;
            expect(atomicNode1.getWord().text).toEqual(' ');
            expect(atomicNode1.getWord().breakable).toEqual(true);
            const atomicNode2 = atomicNode1.getNextSibling() as WordRenderNode;
            expect(atomicNode2.getWord().text).toEqual('Hello');
            expect(atomicNode2.getWord().breakable).toEqual(false);
        });
    });
});
