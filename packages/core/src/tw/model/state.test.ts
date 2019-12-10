import { DocComponent } from 'tw/component/components/doc';
import { ParagraphComponent } from 'tw/component/components/paragraph';
import { TextComponent } from 'tw/component/components/text';
import { ComponentService } from 'tw/component/service';
import { ConfigService } from 'tw/config/service';
import { EventEmitter, IEventEmitter } from 'tw/event/emitter';
import { IEventListener } from 'tw/event/listener';
import { TextMeasurerStub } from 'tw/layout/text-measurer.stub';
import { IInlineModelNode } from 'tw/model/inline-node';
import { ModelState } from 'tw/model/state';
import { IStateService } from 'tw/state/service';
import { IDidUpdateStateEvent } from 'tw/state/state';
import { CLOSE_TOKEN, IToken } from 'tw/state/token';
import { IAppliedTransformation, ITransformation } from 'tw/state/transformation';

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
        textMeasurer = new TextMeasurerStub();
        configService = new ConfigService(
            {
                commands: {},
                components: {
                    doc: new DocComponent('doc'),
                    paragraph: new ParagraphComponent('paragraph'),
                    text: new TextComponent('text', textMeasurer),
                },
            },
            {},
        );
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
