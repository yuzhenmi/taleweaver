import { DocComponent } from '../component/components/doc';
import { ParagraphComponent } from '../component/components/paragraph';
import { TextComponent } from '../component/components/text';
import { TextMeasurerStub } from '../component/components/text-measurer.stub';
import { buildStubConfig } from '../config/config.stub';
import { ConfigService } from '../config/service';
import { CursorService } from '../cursor/service';
import { State } from './state';
import { DeleteOperation, InsertOperation, ITransformation, Transformation } from './transformation';

describe('State', () => {
    let textMeasurer: TextMeasurerStub;
    let configService: ConfigService;
    let cursorService: CursorService;
    let state: State;
    let initialMarkup: string;

    beforeEach(() => {
        const config = buildStubConfig();
        textMeasurer = new TextMeasurerStub();
        config.components.doc = new DocComponent('doc');
        config.components.paragraph = new ParagraphComponent('paragraph');
        config.components.text = new TextComponent('text', textMeasurer);
        configService = new ConfigService(config, {});
        cursorService = new CursorService(configService);
        initialMarkup =
            '<doc {"id":"doc"}><paragraph {"id":"1"}><text {"id":"2"}>Hello</><text {"id":"3","bold":true}>world</></></>';
        state = new State(cursorService, initialMarkup);
    });

    describe('when transformation is applied', () => {
        let transformation: ITransformation;

        beforeEach(() => {
            transformation = new Transformation();
        });

        describe('when transformation includes insert operation', () => {
            it('inserts tokens to state', () => {
                let beforeTokenLength = state.getTokens().length;
                transformation.addOperation(new InsertOperation(3, [' ']));
                state.applyTransformations([transformation]);
                let afterTokenLength = state.getTokens().length;
                expect(afterTokenLength - beforeTokenLength).toEqual(1);
                expect(state.getTokens()[3]).toEqual(' ');
            });
        });

        describe('when transformation includes delete operation', () => {
            it('deletes tokens from state', () => {
                let beforeTokenLength = state.getTokens().length;
                transformation.addOperation(new DeleteOperation(3, 4));
                state.applyTransformations([transformation]);
                let afterTokenLength = state.getTokens().length;
                expect(afterTokenLength - beforeTokenLength).toEqual(-1);
                expect(state.getTokens()[3]).toEqual('e');
            });
        });

        describe('when transformation contains operation', () => {
            it('emits didUpdateStateEvent', () => {
                let isEventEmitted = false;
                state.onDidUpdateState(event => {
                    isEventEmitted = true;
                    expect(event.beforeFrom).toEqual(3);
                    expect(event.beforeTo).toEqual(3);
                    expect(event.afterFrom).toEqual(3);
                    expect(event.afterTo).toEqual(4);
                });
                transformation.addOperation(new InsertOperation(3, [' ']));
                state.applyTransformations([transformation]);
                expect(isEventEmitted).toEqual(true);
            });
        });

        describe('when transformation does not contain any operation', () => {
            it('does not emit didUpdateStateEvent', () => {
                let isEventEmitted = false;
                state.onDidUpdateState(event => {
                    isEventEmitted = true;
                });
                state.applyTransformations([transformation]);
                expect(isEventEmitted).toEqual(false);
            });
        });

        it('updates cursor state', () => {
            transformation.setCursor(2);
            transformation.setCursorHead(3);
            transformation.setCursorLockLeft(100);
            state.applyTransformations([transformation]);
            const cursorState = cursorService.getCursorState();
            expect(cursorState.anchor).toEqual(2);
            expect(cursorState.head).toEqual(3);
            expect(cursorState.leftLock).toEqual(100);
        });
    });
});
