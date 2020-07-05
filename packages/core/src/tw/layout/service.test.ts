import { ModelDoc } from '../component/components/doc';
import { ModelParagraph } from '../component/components/paragraph';
import { ModelText } from '../component/components/text';
import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { ReplaceChange } from '../model/change/replace';
import { IFragment } from '../model/fragment';
import { IModelNode } from '../model/node';
import { ModelService } from '../model/service';
import { RenderService } from '../render/service';
import { ServiceRegistry } from '../service/registry';
import { TextServiceStub } from '../text/service.stub';
import { generateId } from '../util/id';
import { LayoutService } from './service';

describe('LayoutService', () => {
    let configService: ConfigServiceStub;
    let componentService: ComponentService;
    let modelService: ModelService;
    let renderService: RenderService;
    let layoutService: LayoutService;

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
        layoutService = new LayoutService(renderService, textService);
    });

    describe('when model did update', () => {
        describe('when no reflow', () => {
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

            it('updates layout tree', () => {
                const doc = layoutService.getDoc();
                const page = doc.firstChild!;
                const paragraph1 = page.firstChild!;
                const paragraph2 = paragraph1.nextSibling!;
                const paragraph3 = paragraph2.nextSibling!;
                const line1 = paragraph1.firstChild!;
                const line2 = paragraph2.firstChild!;
                const line3 = paragraph3.firstChild!;
                const text1 = line1.firstChild!;
                const lineBreak1 = text1.nextSibling!;
                const text2 = line2.firstChild!;
                const lineBreak2 = text2.nextSibling!;
                const text3 = line3.firstChild!;
                const lineBreak3 = text3.nextSibling!;
                const word1 = text1.firstChild!;
                const word2 = text2.firstChild!;
                const word3 = text3.firstChild!;
                const word4 = word3.nextSibling!;
                expect(lineBreak1).not.toBeNull();
                expect(lineBreak2).not.toBeNull();
                expect(lineBreak3).not.toBeNull();
                expect(word1.text).toEqual('Hi');
                expect(word2.text).toEqual('big');
                expect(word3.text).toEqual('beautiful ');
                expect(word4.text).toEqual('test');
            });
        });

        describe('when line reflow', () => {
            beforeEach(() => {
                // Page inner width is 700, each character width is 20,
                // we need at least 35 characters to trigger line reflow
                const change = new ReplaceChange([0, 0, 0], [0, 0, 6], ['Hello '.repeat(6)]);
                modelService.applyChange(change);
            });

            it('updates layout tree', () => {
                const doc = layoutService.getDoc();
                const page = doc.firstChild!;
                const paragraph1 = page.firstChild!;
                const paragraph2 = paragraph1.nextSibling!;
                const line1 = paragraph1.firstChild!;
                const line2 = line1.nextSibling!;
                const line3 = paragraph2.firstChild!;
                const text1 = line1.firstChild!;
                const text2 = line2.firstChild!;
                const text3 = line3.firstChild!;
                const lineBreak1 = text2.nextSibling!;
                const lineBreak2 = text3.nextSibling!;
                const word1 = text1.firstChild!;
                const word2 = word1.nextSibling!;
                const word3 = word2.nextSibling!;
                const word4 = word3.nextSibling!;
                const word5 = word4.nextSibling!;
                const word6 = text2.firstChild!;
                const word7 = word6.nextSibling!;
                const word8 = text3.firstChild!;
                const word9 = word8.nextSibling!;
                expect(lineBreak1).not.toBeNull();
                expect(lineBreak2).not.toBeNull();
                expect(word1.text).toEqual('Hello ');
                expect(word2.text).toEqual('Hello ');
                expect(word3.text).toEqual('Hello ');
                expect(word4.text).toEqual('Hello ');
                expect(word5.text).toEqual('Hello ');
                expect(word6.text).toEqual('Hello ');
                expect(word7.text).toEqual('world');
                expect(word8.text).toEqual('Hello ');
                expect(word9.text).toEqual('test');
            });
        });

        describe('when page reflow', () => {
            beforeEach(() => {
                // Page inner height is 900, each paragraph height is 181,
                // we need 4 more paragraphs to trigger page reflow
                const fragment: IFragment = ['Hello ', [], [], [], 'beautiful'];
                for (let n = 0; n < 4; n++) {
                    (fragment[2] as IModelNode<any>[]).push(
                        new ModelParagraph('paragraph', generateId(), {}, [new ModelText('text', 'text3', 'big', {})]),
                    );
                }
                const change = new ReplaceChange([0, 0, 0], [0, 0, 5], fragment);
                modelService.applyChange(change);
            });

            it('updates layout tree', () => {
                const doc = layoutService.getDoc();
                const page1 = doc.firstChild!;
                const page2 = page1.nextSibling!;
                const paragraph1 = page1.firstChild!;
                const paragraph2 = paragraph1.nextSibling!;
                const paragraph3 = paragraph2.nextSibling!;
                const paragraph4 = paragraph3.nextSibling!;
                const paragraph5 = page2.firstChild!;
                const paragraph6 = paragraph5.nextSibling!;
                const line1 = paragraph1.firstChild!;
                const line2 = paragraph2.firstChild!;
                const line3 = paragraph3.firstChild!;
                const line4 = paragraph4.firstChild!;
                const line5 = paragraph5.firstChild!;
                const line6 = paragraph6.firstChild!;
                const text1 = line1.firstChild!;
                const text2 = line2.firstChild!;
                const text3 = line3.firstChild!;
                const text4 = line4.firstChild!;
                const text5 = line5.firstChild!;
                const text6 = line6.firstChild!;
                const lineBreak1 = text1.nextSibling!;
                const lineBreak2 = text2.nextSibling!;
                const lineBreak3 = text3.nextSibling!;
                const lineBreak4 = text4.nextSibling!;
                const lineBreak5 = text5.nextSibling!;
                const lineBreak6 = text6.nextSibling!;
                const word1 = text1.firstChild!;
                const word2 = text2.firstChild!;
                const word3 = text3.firstChild!;
                const word4 = text4.firstChild!;
                const word5 = text5.firstChild!;
                const word6 = word5.nextSibling!;
                const word7 = text6.firstChild!;
                const word8 = word7.nextSibling!;
                expect(lineBreak1).not.toBeNull();
                expect(lineBreak2).not.toBeNull();
                expect(lineBreak3).not.toBeNull();
                expect(lineBreak4).not.toBeNull();
                expect(lineBreak5).not.toBeNull();
                expect(lineBreak6).not.toBeNull();
                expect(word1.text).toEqual('Hello ');
                expect(word2.text).toEqual('big');
                expect(word3.text).toEqual('big');
                expect(word4.text).toEqual('big');
                expect(word5.text).toEqual('beautiful ');
                expect(word6.text).toEqual('world');
                expect(word7.text).toEqual('Hello ');
                expect(word8.text).toEqual('test');
            });
        });
    });

    describe('getDoc', () => {
        it('returns doc', () => {
            const doc = layoutService.getDoc();
            const page = doc.firstChild!;
            const paragraph1 = page.firstChild!;
            const paragraph2 = paragraph1.nextSibling!;
            const line1 = paragraph1.firstChild!;
            const line2 = paragraph2.firstChild!;
            const text1 = line1.firstChild!;
            const text2 = line2.firstChild!;
            const lineBreak1 = text1.nextSibling!;
            const lineBreak2 = text2.nextSibling!;
            const word1 = text1.firstChild!;
            const word2 = word1.nextSibling!;
            const word3 = text2.firstChild!;
            const word4 = word3.nextSibling!;
            expect(lineBreak1).not.toBeNull();
            expect(lineBreak2).not.toBeNull();
            expect(word1.text).toEqual('Hello ');
            expect(word2.text).toEqual('world');
            expect(word3.text).toEqual('Hello ');
            expect(word4.text).toEqual('test');
        });
    });
});
