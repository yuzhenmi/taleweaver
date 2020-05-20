import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener } from '../event/listener';
import { IStateService } from '../state/service';
import { IDidApplyTransformation, IDidUpdateStateEvent } from '../state/state';
import { CLOSE_TOKEN, IToken } from '../state/token';
import { IAppliedTransformation, ITransformation } from '../state/transformation';
import { ModelState } from './state';

class StateServiceStub implements IStateService {
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
    let configService: ConfigServiceStub;
    let componentService: ComponentService;
    let stateService: StateServiceStub;
    let modelState: ModelState;

    beforeEach(() => {
        configService = new ConfigServiceStub();
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
        stateService = new StateServiceStub(tokens);
        modelState = new ModelState(componentService, stateService);
    });

    it('initializes model tree from token state', () => {
        const doc = modelState.root;
        expect(doc.componentId).toEqual('doc');
        expect(doc.id).toEqual('doc');
        expect(doc.children).toHaveLength(1);
        const block = doc.firstChild!;
        expect(block.componentId).toEqual('paragraph');
        expect(block.id).toEqual('1');
        expect(block.children).toHaveLength(2);
        const text1 = block.firstChild!;
        expect(text1.componentId).toEqual('text');
        expect(text1.id).toEqual('2');
        expect(text1.text).toEqual('Hello');
        const text2 = text1.nextSibling!;
        expect(text2.componentId).toEqual('text');
        expect(text2.id).toEqual('3');
        expect(text2.attributes).toEqual({ bold: true });
        expect(text2.text).toEqual('world');
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
            const doc = modelState.root;
            expect(doc.children).toHaveLength(1);
            const block = doc.firstChild!;
            expect(block.children).toHaveLength(2);
            const text1 = block.firstChild!;
            expect(text1.text).toEqual(' Hello');
            const text2 = text1.nextSibling!;
            expect(text2.text).toEqual('world');
        });
    });
});
