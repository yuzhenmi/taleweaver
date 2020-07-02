import { CommandService } from '../command/service';
import { ModelDoc } from '../component/components/doc';
import { ModelParagraph } from '../component/components/paragraph';
import { ModelText } from '../component/components/text';
import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { CursorService } from '../cursor/service';
import { DOMServiceStub } from '../dom/service.stub';
import { LayoutService } from '../layout/service';
import { ReplaceChange } from '../model/change/replace';
import { ModelService } from '../model/service';
import { RenderService } from '../render/service';
import { ServiceRegistry } from '../service/registry';
import { TextServiceStub } from '../text/service.stub';
import { TransformService } from '../transform/service';
import { ViewService } from './service';

describe('ViewService', () => {
    let configService: ConfigServiceStub;
    let componentService: ComponentService;
    let modelService: ModelService;
    let renderService: RenderService;
    let layoutService: LayoutService;
    let viewService: ViewService;

    beforeEach(() => {
        const serviceRegistry = new ServiceRegistry();
        configService = new ConfigServiceStub();
        serviceRegistry.registerService('config', configService);
        const textService = new TextServiceStub();
        serviceRegistry.registerService('text', textService);
        const domService = new DOMServiceStub();
        serviceRegistry.registerService('dom', domService);
        componentService = new ComponentService(configService, serviceRegistry);
        const modelDoc = new ModelDoc('doc', 'doc', {}, [
            new ModelParagraph('paragraph', 'paragraph1', {}, [new ModelText('text', 'text1', 'Hello world', {})]),
            new ModelParagraph('paragraph', 'paragraph2', {}, [
                new ModelText('text', 'text2', 'Hello test', { weight: 700 }),
            ]),
        ]);
        modelService = new ModelService(modelDoc, componentService);
        renderService = new RenderService(componentService, modelService);
        const cursorService = new CursorService(configService, renderService, modelService);
        layoutService = new LayoutService(renderService, textService);
        const transformService = new TransformService(
            modelService,
            componentService,
            cursorService,
            renderService,
            layoutService,
        );
        viewService = new ViewService(
            'test',
            configService,
            domService,
            componentService,
            modelService,
            layoutService,
            cursorService,
            renderService,
            new CommandService(configService, new ServiceRegistry()),
            transformService,
        );
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

        it('updates view tree', () => {
            const doc = viewService.getDoc();
            const page = doc.firstChild!;
            const paragraph1 = page.firstChild!;
            const paragraph2 = paragraph1.nextSibling!;
            const paragraph3 = paragraph2.nextSibling!;
            const line1 = paragraph1.firstChild!;
            const line2 = paragraph2.firstChild!;
            const line3 = paragraph3.firstChild!;
            const text1 = line1.firstChild!;
            const text2 = line2.firstChild!;
            const text3 = line3.firstChild!;
            const lineBreak1 = text1.nextSibling!;
            const lineBreak2 = text2.nextSibling!;
            const lineBreak3 = text3.nextSibling!;
            expect(text1.domContainer.querySelector('span')!.innerHTML).toEqual('Hi');
            expect(text2.domContainer.querySelector('span')!.innerHTML).toEqual('big');
            expect(text3.domContainer.querySelector('span')!.innerHTML).toEqual('beautiful test');
            expect(lineBreak1).not.toBeNull();
            expect(lineBreak2).not.toBeNull();
            expect(lineBreak3).not.toBeNull();
        });
    });

    describe('getDoc', () => {
        it('returns doc', () => {
            const doc = viewService.getDoc();
            const page = doc.firstChild!;
            const paragraph1 = page.firstChild!;
            const paragraph2 = paragraph1.nextSibling!;
            const line1 = paragraph1.firstChild!;
            const line2 = paragraph2.firstChild!;
            const text1 = line1.firstChild!;
            const text2 = line2.firstChild!;
            const lineBreak1 = text1.nextSibling!;
            const lineBreak2 = text2.nextSibling!;
            expect(text1.domContainer.querySelector('span')!.innerHTML).toEqual('Hello world');
            expect(text2.domContainer.querySelector('span')!.innerHTML).toEqual('Hello test');
            expect(lineBreak1).not.toBeNull();
            expect(lineBreak2).not.toBeNull();
        });
    });
});
