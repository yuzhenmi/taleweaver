import { ModelDoc } from '../component/components/doc';
import { ModelParagraph } from '../component/components/paragraph';
import { ModelText } from '../component/components/text';
import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { ReplaceChange } from '../model/change/replace';
import { Fragment } from '../model/fragment';
import { ModelService } from '../model/service';
import { ServiceRegistry } from '../service/registry';
import { TextServiceStub } from '../text/service.stub';
import { RenderService } from './service';

describe('RenderService', () => {
    let configService: ConfigServiceStub;
    let componentService: ComponentService;
    let modelService: ModelService;
    let renderService: RenderService;

    beforeEach(() => {
        const serviceRegistry = new ServiceRegistry();
        configService = new ConfigServiceStub();
        serviceRegistry.registerService('config', configService);
        const textService = new TextServiceStub();
        serviceRegistry.registerService('text', textService);
        componentService = new ComponentService(configService, serviceRegistry);
        const modelDoc = new ModelDoc('doc', 'doc', {}, [
            new ModelParagraph('paragraph', 'paragraph1', {}, [new ModelText('text', 'text1', 'Hello world', {})]),
            new ModelParagraph('paragraph', 'paragraph2', {}, [
                new ModelText('text', 'text2', 'Hello test', { weight: 700 }),
            ]),
        ]);
        modelService = new ModelService(modelDoc, componentService);
        renderService = new RenderService(componentService, modelService);
    });

    describe('when model did update', () => {
        beforeEach(() => {
            const change = new ReplaceChange(3, 23, [
                new Fragment('Hi', 0),
                new Fragment(
                    [new ModelParagraph('paragraph', 'paragraph3', {}, [new ModelText('text', 'text3', 'big', {})])],
                    2,
                ),
                new Fragment('beautiful', 0),
            ]);
            modelService.applyChange(change);
        });

        it('updates render tree', () => {
            const doc = renderService.getDoc();
            const paragraph1 = doc.firstChild!;
            const paragraph2 = paragraph1.nextSibling!;
            const paragraph3 = paragraph2.nextSibling!;
            const text1 = paragraph1.firstChild!;
            const lineBreak1 = text1.nextSibling!;
            const text2 = paragraph2.firstChild!;
            const lineBreak2 = text2.nextSibling!;
            const text3 = paragraph3.firstChild!;
            const lineBreak3 = text3.nextSibling!;
            expect(text1.text).toEqual('Hi');
            expect(text2.text).toEqual('big');
            expect(text3.text).toEqual('beautiful test');
            expect(lineBreak1).not.toBeNull();
            expect(lineBreak2).not.toBeNull();
            expect(lineBreak3).not.toBeNull();
        });
    });

    describe('getDoc', () => {
        it('returns doc', () => {
            const doc = renderService.getDoc();
            const paragraph1 = doc.firstChild!;
            const paragraph2 = paragraph1.nextSibling!;
            const text1 = paragraph1.firstChild!;
            const text2 = paragraph2.firstChild!;
            const lineBreak1 = text1.nextSibling!;
            const lineBreak2 = text2.nextSibling!;
            expect(text1.text).toEqual('Hello world');
            expect(text2.text).toEqual('Hello test');
            expect(lineBreak1).not.toBeNull();
            expect(lineBreak2).not.toBeNull();
        });
    });

    describe('getStylesBetween', () => {
        it('returns styles of all render nodes covering the range', () => {
            const styles1 = renderService.getStylesBetween(1, 1);
            expect(styles1).toEqual({
                doc: { doc: [{}] },
                paragraph: { paragraph: [{}] },
                text: {
                    text: [
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
                    ],
                },
            });
            const styles2 = renderService.getStylesBetween(12, 12);
            expect(styles2).toEqual({
                doc: { doc: [{}] },
                paragraph: { paragraph: [{}] },
                text: {
                    text: [
                        {
                            weight: 700,
                            size: 16,
                            family: 'sans-serif',
                            letterSpacing: 0,
                            underline: false,
                            italic: false,
                            strikethrough: false,
                            color: 'black',
                        },
                    ],
                },
            });
            const styles3 = renderService.getStylesBetween(10, 12);
            expect(styles3).toEqual({
                doc: { doc: [{}] },
                paragraph: { 'line-break': [null], paragraph: [{}, {}] },
                text: {
                    text: [
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
                        {
                            weight: 700,
                            size: 16,
                            family: 'sans-serif',
                            letterSpacing: 0,
                            underline: false,
                            italic: false,
                            strikethrough: false,
                            color: 'black',
                        },
                    ],
                },
            });
        });
    });
});
