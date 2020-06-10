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
            new ModelParagraph('paragraph', 'paragraph1', {}, [new ModelText('text', 'text1', 'Hello world', {})]),
            new ModelParagraph('paragraph', 'paragraph2', {}, [new ModelText('text', 'text2', 'Hello test', {})]),
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
                const paragraph1 = doc.firstChild!;
                const paragraph2 = paragraph1.nextSibling!;
                const text1 = paragraph1.firstChild!;
                const text2 = paragraph2.firstChild!;
                expect(text1.text).toEqual('Hi world');
                expect(text2.text).toEqual('Hello test');
            });
        });

        describe('when replace text with text and node', () => {
            beforeEach(() => {
                const change = new ReplaceChange(3, 8, [
                    new Fragment('Hi', 0),
                    new Fragment(
                        [
                            new ModelParagraph('paragraph', 'paragraph3', {}, [
                                new ModelText('text', 'text3', ' big', {}),
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
                const paragraph4 = paragraph3.nextSibling!;
                const text1 = paragraph1.firstChild!;
                const text2 = paragraph2.firstChild!;
                const text3 = paragraph3.firstChild!;
                const text4 = paragraph4.firstChild!;
                expect(text1.text).toEqual('Hi');
                expect(text2.text).toEqual(' big');
                expect(text3.text).toEqual(' beautiful world');
                expect(text4.text).toEqual('Hello test');
            });
        });

        describe('when replace text and node with text', () => {
            beforeEach(() => {
                const change = new ReplaceChange(3, 23, [new Fragment('Hi', 0)]);
                modelService.applyChanges([change]);
            });

            it('works', () => {
                const paragraph1 = doc.firstChild!;
                const text1 = paragraph1.firstChild!;
                expect(text1.text).toEqual('Hi test');
            });
        });

        describe('when replace text and node with text and node', () => {
            beforeEach(() => {
                const change = new ReplaceChange(3, 23, [
                    new Fragment('Hi', 0),
                    new Fragment(
                        [
                            new ModelParagraph('paragraph', 'paragraph3', {}, [
                                new ModelText('text', 'text3', ' big', {}),
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
                expect(text3.text).toEqual(' beautiful test');
            });
        });

        describe('when multiple replace changes', () => {
            beforeEach(() => {
                const change1 = new ReplaceChange(3, 8, [new Fragment('Hi', 0)]);
                const change2 = new ReplaceChange(18, 23, [new Fragment('Hi', 0)]);
                modelService.applyChanges([change1, change2]);
            });

            it('works', () => {
                const paragraph1 = doc.firstChild!;
                const paragraph2 = paragraph1.nextSibling!;
                const text1 = paragraph1.firstChild!;
                const text2 = paragraph2.firstChild!;
                expect(text1.text).toEqual('Hi world');
                expect(text2.text).toEqual('Hi test');
            });
        });
    });

    describe('onDidTransformModelState', () => {
        it('listens to DidTransformModelState event', () => {
            // TODO
        });
    });
});
