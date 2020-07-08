import { ModelDoc } from '../component/components/doc';
import { ModelParagraph } from '../component/components/paragraph';
import { ModelText } from '../component/components/text';
import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { ReplaceChange } from '../model/change/replace';
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
            const change = new ReplaceChange(
                [0, 0, 0],
                [1, 0, 5],
                [
                    'Hi',
                    [],
                    [new ModelParagraph('paragraph', 'paragraph3', {}, [new ModelText('text', 'text3', 'big', {})])],
                    [],
                    'beautiful',
                ],
            );
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

    describe('resolveFont', () => {
        describe('when font property does not conflict', () => {
            it('returns font property', () => {
                expect(renderService.resolveFont(0, 11).weight).toEqual(400);
                expect(renderService.resolveFont(12, 21).weight).toEqual(700);
            });
        });

        describe('when font property conflicts', () => {
            it('returns null as font property', () => {
                expect(renderService.resolveFont(11, 13).weight).toEqual(null);
            });
        });
    });
});
