import { DocComponent } from '../component/components/doc';
import { ParagraphComponent } from '../component/components/paragraph';
import { TextComponent } from '../component/components/text';
import { TextMeasurerStub } from '../component/components/text-measurer.stub';
import { ComponentService } from '../component/service';
import { buildStubConfig } from '../config/config.stub';
import { ConfigService } from '../config/service';
import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener } from '../event/listener';
import { IStateService } from '../state/service';
import { IDidApplyTransformation, IDidUpdateStateEvent } from '../state/state';
import { CLOSE_TOKEN, IToken } from '../state/token';
import { IAppliedTransformation, ITransformation } from '../state/transformation';
import { IInlineModelNode } from './inline-node';
import { ModelState } from './state';

class MockStateService implements IStateService {
    protected didUpdateStateEventEmitter: IEventEmitter<IDidUpdateStateEvent> = new EventEmitter();

    constructor(protected tokens: IToken[]) {}

    setTokens(tokens: IToken[]) {
        this.tokens = tokens;
    }

    emitDidUpdateStateEvent(event: IDidUpdateStateEvent) {
        this.didUpdateStateEventEmitter.emit(event);
    }

    onDidUpdateState(listener: IEventListener<IDidUpdateStateEvent>) {
        this.didUpdateStateEventEmitter.on(listener);
    }

    onDidApplyTransformation(listener: IEventListener<IDidApplyTransformation>) {}

    getTokens() {
        return this.tokens;
    }

    applyTransformations(transformations: ITransformation[]): IAppliedTransformation[] {
        throw new Error('Not implemented.');
    }
    applyTransformation(transformation: ITransformation): IAppliedTransformation {
        throw new Error('Not implemented.');
    }
    unapplyTransformations(appliedTransformations: IAppliedTransformation[]): void {
        throw new Error('Not implemented.');
    }
    unapplyTransformation(appliedTransformation: IAppliedTransformation): void {
        throw new Error('Not implemented.');
    }
}

describe('ModelState', () => {
    let textMeasurer: TextMeasurerStub;
    let configService: ConfigService;
    let componentService: ComponentService;
    let stateService: MockStateService;
    let modelState: ModelState;

    beforeEach(() => {
        const config = buildStubConfig();
        textMeasurer = new TextMeasurerStub();
        config.components.doc = new DocComponent('doc');
        config.components.paragraph = new ParagraphComponent('paragraph');
        config.components.text = new TextComponent('text', textMeasurer);
        configService = new ConfigService(config, {});
        componentService = new ComponentService(configService);
        const tokens = [
            { componentId: 'doc', id: 'doc', attributes: {} },
            { componentId: 'paragraph', id: '1', attributes: {} },
            { componentId: 'text', id: '2', attributes: {} },
            'H',
            'e',
            'l',
            'l',
            'o',
            CLOSE_TOKEN,
            { componentId: 'text', id: '3', attributes: { bold: true } },
            'w',
            'o',
            'r',
            'l',
            'd',
            CLOSE_TOKEN,
            CLOSE_TOKEN,
            CLOSE_TOKEN,
        ];
        stateService = new MockStateService(tokens);
        modelState = new ModelState(componentService, stateService);
    });

    it('initializes model tree from token state', () => {
        const docNode = modelState.getDocNode();
        expect(docNode.getComponentId()).toEqual('doc');
        expect(docNode.getId()).toEqual('doc');
        expect(docNode.getChildren()).toHaveLength(1);
        const blockNode = docNode.getFirstChild()!;
        expect(blockNode.getComponentId()).toEqual('paragraph');
        expect(blockNode.getId()).toEqual('1');
        expect(blockNode.getChildren()).toHaveLength(2);
        const inlineNode1 = blockNode.getFirstChild()!;
        expect(inlineNode1.getComponentId()).toEqual('text');
        expect(inlineNode1.getId()).toEqual('2');
        expect(inlineNode1.getContent()).toEqual('Hello');
        const inlineNode2 = inlineNode1.getNextSibling()! as IInlineModelNode;
        expect(inlineNode2.getComponentId()).toEqual('text');
        expect(inlineNode2.getId()).toEqual('3');
        expect(inlineNode2.getAttributes()).toEqual({ bold: true });
        expect(inlineNode2.getContent()).toEqual('world');
    });

    describe('when token state did update', () => {
        it('updates model tree', () => {
            stateService.setTokens([
                { componentId: 'doc', id: 'doc', attributes: {} },
                { componentId: 'paragraph', id: '1', attributes: {} },
                { componentId: 'text', id: '2', attributes: {} },
                ' ',
                'H',
                'e',
                'l',
                'l',
                'o',
                CLOSE_TOKEN,
                { componentId: 'text', id: '3', attributes: { bold: true } },
                'w',
                'o',
                'r',
                'l',
                'd',
                CLOSE_TOKEN,
                CLOSE_TOKEN,
                CLOSE_TOKEN,
            ]);
            stateService.emitDidUpdateStateEvent({
                beforeFrom: 3,
                beforeTo: 3,
                afterFrom: 3,
                afterTo: 4,
            });
            const docNode = modelState.getDocNode();
            expect(docNode.getChildren()).toHaveLength(1);
            const blockNode = docNode.getFirstChild()!;
            expect(blockNode.getChildren()).toHaveLength(2);
            const inlineNode1 = blockNode.getFirstChild()!;
            expect(inlineNode1.getContent()).toEqual(' Hello');
            const inlineNode2 = inlineNode1.getNextSibling()! as IInlineModelNode;
            expect(inlineNode2.getContent()).toEqual('world');
        });
    });
});
