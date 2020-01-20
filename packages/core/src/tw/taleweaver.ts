import * as clipboardCommandHandlers from './command/handlers/clipboard';
import * as cursorCommandHandlers from './command/handlers/cursor';
import * as historyCommandHandlers from './command/handlers/history';
import * as stateCommandHandlers from './command/handlers/state';
import * as viewCommandHandlers from './command/handlers/view';
import { CommandService, ICommandService } from './command/service';
import { DocComponent } from './component/components/doc';
import { ParagraphComponent } from './component/components/paragraph';
import { TextComponent, TextMeasurer } from './component/components/text';
import { ComponentService, IComponentService } from './component/service';
import { IConfig, IExternalConfig } from './config/config';
import { ConfigService, IConfigService } from './config/service';
import { CursorService, ICursorService } from './cursor/service';
import { HistoryService, IHistoryService } from './history/service';
import { IKeyBindingService, KeyBindingService } from './key-binding/service';
import { ILayoutService, LayoutService } from './layout/service';
import { IModelService, ModelService } from './model/service';
import { IRenderService, RenderService } from './render/service';
import { IServiceRegistry, ServiceRegistry } from './service/registry';
import { IStateService, StateService } from './state/service';
import { generateId } from './util/id';
import { IViewService, ViewService } from './view/service';

export interface ITaleweaver {
    attach(domContainer: HTMLElement): void;
    getServiceRegistry(): IServiceRegistry;
}

export class Taleweaver {
    protected instanceId: string;
    protected serviceRegistry: IServiceRegistry;
    protected commandService: ICommandService;
    protected componentService: IComponentService;
    protected configService: IConfigService;
    protected cursorService: ICursorService;
    protected historyService: IHistoryService;
    protected keyBindingService: IKeyBindingService;
    protected layoutService: ILayoutService;
    protected modelService: IModelService;
    protected renderService: IRenderService;
    protected stateService: IStateService;
    protected viewService: IViewService;

    constructor(initialMarkup: string, config: IExternalConfig) {
        this.instanceId = generateId();
        this.serviceRegistry = new ServiceRegistry();
        this.configService = new ConfigService(this.buildBaseConfig(), config);
        this.commandService = new CommandService(this.configService, this.serviceRegistry);
        this.componentService = new ComponentService(this.configService);
        this.cursorService = new CursorService(this.configService);
        this.stateService = new StateService(this.cursorService, initialMarkup);
        this.historyService = new HistoryService(this.configService, this.stateService);
        this.modelService = new ModelService(this.componentService, this.stateService);
        this.renderService = new RenderService(this.componentService, this.modelService);
        this.layoutService = new LayoutService(this.componentService, this.renderService);
        this.viewService = new ViewService(
            this.instanceId,
            this.componentService,
            this.layoutService,
            this.cursorService,
            this.renderService,
            this.commandService,
        );
        this.keyBindingService = new KeyBindingService(this.configService, this.commandService, this.viewService);
        this.registerServices();
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
                'tw.cursor.moveUp': cursorCommandHandlers.moveUp,
                'tw.cursor.moveDown': cursorCommandHandlers.moveDown,
                'tw.cursor.moveLeft': cursorCommandHandlers.moveLeft,
                'tw.cursor.moveRight': cursorCommandHandlers.moveRight,
                'tw.cursor.moveLeftByWord': cursorCommandHandlers.moveLeftByWord,
                'tw.cursor.moveRightByWord': cursorCommandHandlers.moveRightByWord,
                'tw.cursor.moveToLineStart': cursorCommandHandlers.moveToLineStart,
                'tw.cursor.moveToLineEnd': cursorCommandHandlers.moveToLineEnd,
                'tw.cursor.moveToDocStart': cursorCommandHandlers.moveToDocStart,
                'tw.cursor.moveToDocEnd': cursorCommandHandlers.moveToDocEnd,
                'tw.cursor.moveHead': cursorCommandHandlers.moveHead,
                'tw.cursor.moveHeadUp': cursorCommandHandlers.moveHeadUp,
                'tw.cursor.moveHeadDown': cursorCommandHandlers.moveHeadDown,
                'tw.cursor.moveHeadLeft': cursorCommandHandlers.moveHeadLeft,
                'tw.cursor.moveHeadRight': cursorCommandHandlers.moveHeadRight,
                'tw.cursor.moveHeadLeftByWord': cursorCommandHandlers.moveHeadLeftByWord,
                'tw.cursor.moveHeadRightByWord': cursorCommandHandlers.moveHeadRightByWord,
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
                'tw.state.splitLine': stateCommandHandlers.splitLine,
                'tw.view.focus': viewCommandHandlers.focus,
                'tw.view.blur': viewCommandHandlers.blur,
            },
            components: {
                doc: new DocComponent('doc'),
                paragraph: new ParagraphComponent('paragraph'),
                text: new TextComponent('text', new TextMeasurer()),
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
                    left: { command: 'tw.cursor.moveLeft' },
                    right: { command: 'tw.cursor.moveRight' },
                    up: { command: 'tw.cursor.moveUp' },
                    down: { command: 'tw.cursor.moveDown' },
                    'shift+left': { command: 'tw.cursor.moveHeadLeft' },
                    'shift+right': { command: 'tw.cursor.moveHeadRight' },
                    'shift+up': { command: 'tw.cursor.moveHeadUp' },
                    'shift+down': { command: 'tw.cursor.moveHeadDown' },
                    backspace: { command: 'tw.state.deleteBackward' },
                    delete: { command: 'tw.state.deleteForward' },
                    enter: { command: 'tw.state.splitLine' },
                },
                macos: {
                    'alt+left': { command: 'tw.cursor.moveLeftByWord' },
                    'alt+right': { command: 'tw.cursor.moveRightByWord' },
                    'shift+alt+left': { command: 'tw.cursor.moveHeadLeftByWord' },
                    'shift+alt+right': { command: 'tw.cursor.moveHeadRightByWord' },
                    'cmd+left': { command: 'tw.cursor.moveToLineStart' },
                    'cmd+right': { command: 'tw.cursor.moveToLineEnd' },
                    'cmd+up': { command: 'tw.cursor.moveToDocStart' },
                    'cmd+down': { command: 'tw.cursor.moveToDocEnd' },
                    'shift+cmd+left': { command: 'tw.cursor.moveHeadToLineStart' },
                    'shift+cmd+right': { command: 'tw.cursor.moveHeadToLineEnd' },
                    'shift+cmd+up': { command: 'tw.cursor.moveHeadToDocStart' },
                    'shift+cmd+down': { command: 'tw.cursor.moveHeadToDocEnd' },
                    'cmd+a': { command: 'tw.cursor.selectAll' },
                    'cmd+z': { command: 'tw.history.undo' },
                    'shift+cmd+z': { command: 'tw.history.redo' },
                    'cmd+c': { command: 'tw.clipboard.copy' },
                    'cmd+v': { command: 'tw.clipboard.paste' },
                },
                windows: {
                    'ctrl+left': { command: 'tw.cursor.moveLeftByWord' },
                    'ctrl+right': { command: 'tw.cursor.moveRightByWord' },
                    'ctrl+shift+left': { command: 'tw.cursor.moveHeadLeftByWord' },
                    'ctrl+shift+right': { command: 'tw.cursor.moveHeadRightByWord' },
                    home: { command: 'tw.cursor.moveToLineStart' },
                    end: { command: 'tw.cursor.moveToLineEnd' },
                    'ctrl+home': { command: 'tw.cursor.moveToDocStart' },
                    'ctrl+end': { command: 'tw.cursor.moveToDocEnd' },
                    'shift+home': { command: 'tw.cursor.moveHeadToLineStart' },
                    'shift+end': { command: 'tw.cursor.moveHeadToLineEnd' },
                    'ctrl+shift+home': { command: 'tw.cursor.moveHeadToDocStart' },
                    'ctrl+shift+end': { command: 'tw.cursor.moveHeadToDocEnd' },
                    'ctrl+a': { command: 'tw.cursor.selectAll' },
                    'ctrl+z': { command: 'tw.history.undo' },
                    'ctrl+shift+z': { command: 'tw.history.redo' },
                    'ctrl+c': { command: 'tw.clipboard.copy' },
                    'ctrl+v': { command: 'tw.clipboard.paste' },
                },
                linux: {
                    'ctrl+left': { command: 'tw.cursor.moveLeftByWord' },
                    'ctrl+right': { command: 'tw.cursor.moveRightByWord' },
                    'ctrl+shift+left': { command: 'tw.cursor.moveHeadLeftByWord' },
                    'ctrl+shift+right': { command: 'tw.cursor.moveHeadRightByWord' },
                    home: { command: 'tw.cursor.moveToLineStart' },
                    end: { command: 'tw.cursor.moveToLineEnd' },
                    'ctrl+home': { command: 'tw.cursor.moveToDocStart' },
                    'ctrl+end': { command: 'tw.cursor.moveToDocEnd' },
                    'shift+home': { command: 'tw.cursor.moveHeadToLineStart' },
                    'shift+end': { command: 'tw.cursor.moveHeadToLineEnd' },
                    'ctrl+shift+home': { command: 'tw.cursor.moveHeadToDocStart' },
                    'ctrl+shift+end': { command: 'tw.cursor.moveHeadToDocEnd' },
                    'ctrl+a': { command: 'tw.cursor.selectAll' },
                    'ctrl+z': { command: 'tw.history.undo' },
                    'ctrl+shift+z': { command: 'tw.history.redo' },
                    'ctrl+c': { command: 'tw.clipboard.copy' },
                    'ctrl+v': { command: 'tw.clipboard.paste' },
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

    protected registerServices() {
        this.serviceRegistry.registerService('config', this.configService);
        this.serviceRegistry.registerService('command', this.commandService);
        this.serviceRegistry.registerService('component', this.componentService);
        this.serviceRegistry.registerService('cursor', this.cursorService);
        this.serviceRegistry.registerService('history', this.historyService);
        this.serviceRegistry.registerService('state', this.stateService);
        this.serviceRegistry.registerService('model', this.modelService);
        this.serviceRegistry.registerService('render', this.renderService);
        this.serviceRegistry.registerService('layout', this.layoutService);
        this.serviceRegistry.registerService('view', this.viewService);
        this.serviceRegistry.registerService('keyBinding', this.keyBindingService);
    }
}
