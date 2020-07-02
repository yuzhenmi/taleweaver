import { ModelDoc } from '../component/components/doc';
import { ModelParagraph } from '../component/components/paragraph';
import { ModelText } from '../component/components/text';
import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { ServiceRegistry } from '../service/registry';
import { ReplaceChange } from './change/replace';
import { ModelService } from './service';

describe('ModelService', () => {
    let doc: ModelDoc;
    let modelService: ModelService;
    let componentService: ComponentService;

    beforeEach(() => {
        const configService = new ConfigServiceStub();
        const serviceRegistry = new ServiceRegistry();
        componentService = new ComponentService(configService, serviceRegistry);
        doc = new ModelDoc('doc', 'doc', {}, [
            new ModelParagraph('paragraph', 'paragraph1', {}, [new ModelText('text', 'text1', 'Hello world', {})]),
            new ModelParagraph('paragraph', 'paragraph2', {}, [new ModelText('text', 'text2', 'Hello test', {})]),
        ]);
        modelService = new ModelService(doc, componentService);
    });

    describe('applyTransformation', () => {
        describe('when replace text with text', () => {
            beforeEach(() => {
                const change = new ReplaceChange([0, 0, 0], [0, 0, 5], ['Hi']);
                modelService.applyChange(change);
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
                const change = new ReplaceChange(
                    [0, 0, 0],
                    [0, 0, 5],
                    [
                        'Hi',
                        [],
                        [
                            new ModelParagraph('paragraph', 'paragraph3', {}, [
                                new ModelText('text', 'text3', 'big', {}),
                            ]),
                        ],
                        [],
                        'beautiful',
                    ],
                );
                modelService.applyChange(change);
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
                expect(text2.text).toEqual('big');
                expect(text3.text).toEqual('beautiful world');
                expect(text4.text).toEqual('Hello test');
            });
        });

        describe('when replace text and node with text', () => {
            beforeEach(() => {
                const change = new ReplaceChange([0, 0, 0], [1, 0, 5], ['Hi']);
                modelService.applyChange(change);
            });

            it('works', () => {
                const paragraph1 = doc.firstChild!;
                const text1 = paragraph1.firstChild!;
                expect(text1.text).toEqual('Hi test');
            });
        });

        describe('when replace text and node with text and node', () => {
            beforeEach(() => {
                const change = new ReplaceChange(
                    [0, 0, 0],
                    [1, 0, 5],
                    [
                        'Hi',
                        [],
                        [
                            new ModelParagraph('paragraph', 'paragraph3', {}, [
                                new ModelText('text', 'text3', 'big', {}),
                            ]),
                        ],
                        [],
                        'beautiful',
                    ],
                );
                modelService.applyChange(change);
            });

            it('works', () => {
                const paragraph1 = doc.firstChild!;
                const paragraph2 = paragraph1.nextSibling!;
                const paragraph3 = paragraph2.nextSibling!;
                const text1 = paragraph1.firstChild!;
                const text2 = paragraph2.firstChild!;
                const text3 = paragraph3.firstChild!;
                expect(text1.text).toEqual('Hi');
                expect(text2.text).toEqual('big');
                expect(text3.text).toEqual('beautiful test');
            });
        });
    });

    describe('getRoot', () => {
        it('returns root node', () => {
            const root = modelService.getRoot();
            expect(root).toEqual(doc);
        });
    });

    describe('onDidUpdateModelState', () => {
        it('listens to DidUpdateModelState event', () => {
            let notified = false;
            modelService.onDidUpdateModelState(() => (notified = true));
            const change = new ReplaceChange([0, 0, 0], [0, 0, 5], ['Hi']);
            modelService.applyChange(change);
            expect(notified).toEqual(true);
        });
    });
});
