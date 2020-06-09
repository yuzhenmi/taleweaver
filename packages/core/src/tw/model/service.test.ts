import { ModelDoc } from '../component/components/doc';
import { ModelParagraph } from '../component/components/paragraph';
import { ModelText } from '../component/components/text';
import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { ReplaceChange } from './change/replace';
import { Fragment } from './fragment';
import { ModelService } from './service';

describe('ModelService', () => {
    let doc: ModelDoc;
    let modelService: ModelService;
    let componentService: ComponentService;

    beforeEach(() => {
        const configService = new ConfigServiceStub();
        componentService = new ComponentService(configService);
        doc = new ModelDoc('doc', 'doc', {}, [
            new ModelParagraph('paragraph', 'paragraph', {}, [new ModelText('text', 'text', 'Hello world', {})]),
        ]);
        modelService = new ModelService(doc, componentService);
    });

    describe('getRoot', () => {
        it('returns root node', () => {
            const root = modelService.getRoot();
            expect(root).toEqual(doc);
        });
    });

    describe('applyTransformation', () => {
        describe('when replace text with text', () => {
            beforeEach(() => {
                const change = new ReplaceChange(3, 8, [new Fragment('Hi', 0)]);
                modelService.applyChanges([change]);
            });

            it('works', () => {
                expect(doc.firstChild!.firstChild!.text).toEqual('Hi world');
            });
        });

        describe('when replace text with text and node', () => {
            beforeEach(() => {
                const change = new ReplaceChange(3, 8, [
                    new Fragment('Hi', 0),
                    new Fragment(
                        [
                            new ModelParagraph('paragraph', 'paragraph2', {}, [
                                new ModelText('text', 'text2', ' big', {}),
                            ]),
                        ],
                        2,
                    ),
                    new Fragment(' beautiful', 0),
                ]);
                modelService.applyChanges([change]);
            });

            it('works', () => {
                const paragraph1 = doc.firstChild!;
                const paragraph2 = paragraph1.nextSibling!;
                const paragraph3 = paragraph2.nextSibling!;
                const text1 = paragraph1.firstChild!;
                const text2 = paragraph2.firstChild!;
                const text3 = paragraph3.firstChild!;
                expect(text1.text).toEqual('Hi');
                expect(text2.text).toEqual(' big');
                expect(text3.text).toEqual(' beautiful world');
            });
        });

        describe('when replace text and node with text', () => {
            // TODO
        });

        describe('when replace text and node with text and node', () => {
            // TODO
        });

        describe('when multiple replace changes', () => {
            // TODO
        });
    });

    describe('onDidTransformModelState', () => {
        it('listens to DidTransformModelState event', () => {
            // TODO
        });
    });
});
