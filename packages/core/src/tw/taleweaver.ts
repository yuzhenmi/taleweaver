import * as clipboardCommandHandlers from './command/handlers/clipboard';
import * as cursorCommandHandlers from './command/handlers/cursor';
import * as historyCommandHandlers from './command/handlers/history';
import * as stateCommandHandlers from './command/handlers/state';
import * as viewCommandHandlers from './command/handlers/view';
import { CommandService, ICommandService } from './command/service';
import { DocComponent } from './component/components/doc';
import { ParagraphComponent } from './component/components/paragraph';
import { TextComponent } from './component/components/text';
import { ComponentService, IComponentService } from './component/service';
import { IConfig, IExternalConfig } from './config/config';
import { ConfigService, IConfigService } from './config/service';
import { CursorService, ICursorService } from './cursor/service';
import { DOMService, IDOMService } from './dom/service';
import { HistoryService, IHistoryService } from './history/service';
import { IKeyBindingService, KeyBindingService } from './key-binding/service';
import { ILayoutService, LayoutService } from './layout/service';
import { IModelRoot } from './model/root';
import { IModelService, ModelService } from './model/service';
import { IRenderService, RenderService } from './render/service';
import { IServiceRegistry, ServiceRegistry } from './service/registry';
import { ITextService, TextService } from './text/service';
import { ITransformService, TransformService } from './transform/service';
import { generateId } from './util/id';
import { IViewService, ViewService } from './view/service';

export interface ITaleweaver {
    attach(domContainer: HTMLElement): void;
    getServiceRegistry(): IServiceRegistry;
}

export class Taleweaver {
    protected instanceId: string;
    protected serviceRegistry: IServiceRegistry;
    protected configService: IConfigService;
    protected domService: IDOMService;
    protected textService: ITextService;
    protected commandService: ICommandService;
    protected componentService: IComponentService;
    protected modelService: IModelService;
    protected renderService: IRenderService;
    protected cursorService: ICursorService;
    protected layoutService: ILayoutService;
    protected viewService: IViewService;
    protected transformService: ITransformService;
    protected historyService: IHistoryService;
    protected keyBindingService: IKeyBindingService;

    constructor(root: IModelRoot<any>, config: IExternalConfig) {
        this.instanceId = generateId();
        this.serviceRegistry = new ServiceRegistry();
        this.configService = new ConfigService(this.buildBaseConfig(), config);
        this.serviceRegistry.registerService('config', this.configService);
        this.domService = new DOMService();
        this.serviceRegistry.registerService('dom', this.domService);
        this.textService = new TextService(this.domService);
        this.serviceRegistry.registerService('text', this.textService);
        this.commandService = new CommandService(this.configService, this.serviceRegistry);
        this.serviceRegistry.registerService('command', this.commandService);
        this.componentService = new ComponentService(this.configService, this.serviceRegistry);
        this.serviceRegistry.registerService('component', this.componentService);
        this.modelService = new ModelService(root, this.componentService);
        this.serviceRegistry.registerService('model', this.modelService);
        this.renderService = new RenderService(this.componentService, this.modelService);
        this.serviceRegistry.registerService('render', this.renderService);
        this.cursorService = new CursorService(this.configService, this.renderService, this.modelService);
        this.serviceRegistry.registerService('cursor', this.cursorService);
        this.layoutService = new LayoutService(this.renderService, this.textService);
        this.serviceRegistry.registerService('layout', this.layoutService);
        this.transformService = new TransformService(
            this.modelService,
            this.componentService,
            this.cursorService,
            this.renderService,
            this.layoutService,
        );
        this.serviceRegistry.registerService('transform', this.transformService);
        this.viewService = new ViewService(
            this.instanceId,
            this.domService,
            this.componentService,
            this.modelService,
            this.layoutService,
            this.cursorService,
            this.renderService,
            this.commandService,
            this.transformService,
        );
        this.serviceRegistry.registerService('view', this.viewService);
        this.historyService = new HistoryService(this.configService, this.transformService);
        this.serviceRegistry.registerService('history', this.historyService);
        this.keyBindingService = new KeyBindingService(this.configService, this.commandService, this.viewService);
        this.serviceRegistry.registerService('keyBinding', this.keyBindingService);
    }

    attach(domContainer: HTMLElement) {
        this.viewService.attach(domContainer);
    }

    getServiceRegistry() {
        return this.serviceRegistry;
    }

    protected buildBaseConfig(): IConfig {
        return {
            commands: {
                'tw.clipboard.copy': clipboardCommandHandlers.copy,
                'tw.clipboard.paste': clipboardCommandHandlers.paste,
                'tw.cursor.move': cursorCommandHandlers.move,
                'tw.cursor.moveBackwardByLine': cursorCommandHandlers.moveBackwardByLine,
                'tw.cursor.moveForwardByLine': cursorCommandHandlers.moveForwardByLine,
                'tw.cursor.moveBackward': cursorCommandHandlers.moveBackward,
                'tw.cursor.moveForward': cursorCommandHandlers.moveForward,
                'tw.cursor.moveBackwardByWord': cursorCommandHandlers.moveBackwardByWord,
                'tw.cursor.moveForwardByWord': cursorCommandHandlers.moveForwardByWord,
                'tw.cursor.moveToLineStart': cursorCommandHandlers.moveToLineStart,
                'tw.cursor.moveToLineEnd': cursorCommandHandlers.moveToLineEnd,
                'tw.cursor.moveToDocStart': cursorCommandHandlers.moveToDocStart,
                'tw.cursor.moveToDocEnd': cursorCommandHandlers.moveToDocEnd,
                'tw.cursor.moveHead': cursorCommandHandlers.moveHead,
                'tw.cursor.moveHeadBackwardByLine': cursorCommandHandlers.moveHeadBackwardByLine,
                'tw.cursor.moveHeadForwardByLine': cursorCommandHandlers.moveHeadForwardByLine,
                'tw.cursor.moveHeadBackward': cursorCommandHandlers.moveHeadBackward,
                'tw.cursor.moveHeadForward': cursorCommandHandlers.moveHeadForward,
                'tw.cursor.moveHeadBackwardByWord': cursorCommandHandlers.moveHeadBackwardByWord,
                'tw.cursor.moveHeadForwardByWord': cursorCommandHandlers.moveHeadForwardByWord,
                'tw.cursor.moveHeadToLineStart': cursorCommandHandlers.moveHeadToLineStart,
                'tw.cursor.moveHeadToLineEnd': cursorCommandHandlers.moveHeadToLineEnd,
                'tw.cursor.moveHeadToDocStart': cursorCommandHandlers.moveHeadToDocStart,
                'tw.cursor.moveHeadToDocEnd': cursorCommandHandlers.moveHeadToDocEnd,
                'tw.cursor.selectAll': cursorCommandHandlers.selectAll,
                'tw.cursor.selectWord': cursorCommandHandlers.selectWord,
                'tw.cursor.selectBlock': cursorCommandHandlers.selectBlock,
                'tw.history.undo': historyCommandHandlers.undo,
                'tw.history.redo': historyCommandHandlers.redo,
                'tw.state.insert': stateCommandHandlers.insert,
                'tw.state.deleteBackward': stateCommandHandlers.deleteBackward,
                'tw.state.deleteForward': stateCommandHandlers.deleteForward,
                'tw.state.breakLine': stateCommandHandlers.breakLine,
                'tw.view.focus': viewCommandHandlers.focus,
                'tw.view.blur': viewCommandHandlers.blur,
            },
            components: {
                doc: DocComponent,
                paragraph: ParagraphComponent,
                text: TextComponent,
            },
            cursor: {
                disable: false,
            },
            history: {
                collapseThreshold: 500,
                maxCollapseDuration: 2000,
            },
            keyBindings: {
                common: {
                    left: { command: 'tw.cursor.moveBackward', preventDefault: true },
                    right: { command: 'tw.cursor.moveForward', preventDefault: true },
                    up: { command: 'tw.cursor.moveBackwardByLine', preventDefault: true },
                    down: { command: 'tw.cursor.moveForwardByLine', preventDefault: true },
                    'shift+left': { command: 'tw.cursor.moveHeadBackward', preventDefault: true },
                    'shift+right': { command: 'tw.cursor.moveHeadForward', preventDefault: true },
                    'shift+up': { command: 'tw.cursor.moveHeadBackwardByLine', preventDefault: true },
                    'shift+down': { command: 'tw.cursor.moveHeadForwardByLine', preventDefault: true },
                    backspace: { command: 'tw.state.deleteBackward', preventDefault: true },
                    delete: { command: 'tw.state.deleteForward', preventDefault: true },
                    enter: { command: 'tw.state.breakLine', preventDefault: true },
                },
                macos: {
                    'alt+left': { command: 'tw.cursor.moveBackwardByWord' },
                    'alt+right': { command: 'tw.cursor.moveForwardByWord' },
                    'shift+alt+left': { command: 'tw.cursor.moveHeadBackwardByWord' },
                    'shift+alt+right': { command: 'tw.cursor.moveHeadForwardByWord' },
                    'cmd+left': { command: 'tw.cursor.moveToLineStart' },
                    'cmd+right': { command: 'tw.cursor.moveToLineEnd' },
                    'cmd+up': { command: 'tw.cursor.moveToDocStart' },
                    'cmd+down': { command: 'tw.cursor.moveToDocEnd' },
                    'shift+cmd+left': { command: 'tw.cursor.moveHeadToLineStart' },
                    'shift+cmd+right': { command: 'tw.cursor.moveHeadToLineEnd' },
                    'shift+cmd+up': { command: 'tw.cursor.moveHeadToDocStart' },
                    'shift+cmd+down': { command: 'tw.cursor.moveHeadToDocEnd' },
                    'cmd+a': { command: 'tw.cursor.selectAll' },
                    'cmd+z': { command: 'tw.history.undo', preventDefault: true },
                    'shift+cmd+z': { command: 'tw.history.redo', preventDefault: true },
                },
                windows: {
                    'ctrl+left': { command: 'tw.cursor.moveBackwardByWord' },
                    'ctrl+right': { command: 'tw.cursor.moveForwardByWord' },
                    'ctrl+shift+left': { command: 'tw.cursor.moveHeadBackwardByWord' },
                    'ctrl+shift+right': { command: 'tw.cursor.moveHeadForwardByWord' },
                    home: { command: 'tw.cursor.moveToLineStart' },
                    end: { command: 'tw.cursor.moveToLineEnd' },
                    'ctrl+home': { command: 'tw.cursor.moveToDocStart' },
                    'ctrl+end': { command: 'tw.cursor.moveToDocEnd' },
                    'shift+home': { command: 'tw.cursor.moveHeadToLineStart' },
                    'shift+end': { command: 'tw.cursor.moveHeadToLineEnd' },
                    'ctrl+shift+home': { command: 'tw.cursor.moveHeadToDocStart' },
                    'ctrl+shift+end': { command: 'tw.cursor.moveHeadToDocEnd' },
                    'ctrl+a': { command: 'tw.cursor.selectAll' },
                    'ctrl+z': { command: 'tw.history.undo', preventDefault: true },
                    'ctrl+shift+z': { command: 'tw.history.redo', preventDefault: true },
                },
                linux: {
                    'ctrl+left': { command: 'tw.cursor.moveBackwardByWord' },
                    'ctrl+right': { command: 'tw.cursor.moveForwardByWord' },
                    'ctrl+shift+left': { command: 'tw.cursor.moveHeadBackwardByWord' },
                    'ctrl+shift+right': { command: 'tw.cursor.moveHeadForwardByWord' },
                    home: { command: 'tw.cursor.moveToLineStart' },
                    end: { command: 'tw.cursor.moveToLineEnd' },
                    'ctrl+home': { command: 'tw.cursor.moveToDocStart' },
                    'ctrl+end': { command: 'tw.cursor.moveToDocEnd' },
                    'shift+home': { command: 'tw.cursor.moveHeadToLineStart' },
                    'shift+end': { command: 'tw.cursor.moveHeadToLineEnd' },
                    'ctrl+shift+home': { command: 'tw.cursor.moveHeadToDocStart' },
                    'ctrl+shift+end': { command: 'tw.cursor.moveHeadToDocEnd' },
                    'ctrl+a': { command: 'tw.cursor.selectAll' },
                    'ctrl+z': { command: 'tw.history.undo', preventDefault: true },
                    'ctrl+shift+z': { command: 'tw.history.redo', preventDefault: true },
                },
            },
            page: {
                width: 816,
                height: 1056,
                paddingTop: 40,
                paddingBottom: 40,
                paddingLeft: 40,
                paddingRight: 40,
            },
        };
    }
}
