import Config from './config/Config';
import CursorService from './cursor/CursorService';
import Dispatcher from './dispatch/Dispatcher';
import HistoryService from './history/HistoryService';
import LayoutService from './layout/LayoutService';
import ModelService from './model/ModelService';
import RenderService from './render/RenderService';
import StateService from './state/StateService';
import generateID from './utils/generateID';
import ViewService from './view/ViewService';

export default class Editor {
    protected id: string;
    protected config: Config;
    protected dispatcher: Dispatcher;
    protected historyService: HistoryService;
    protected cursorService: CursorService;
    protected stateService: StateService;
    protected modelService: ModelService;
    protected renderService: RenderService;
    protected layoutService: LayoutService;
    protected viewService: ViewService;

    constructor(config: Config) {
        this.id = generateID();
        this.config = config;
        this.dispatcher = new Dispatcher(this);
        this.cursorService = new CursorService(this);
        this.historyService = new HistoryService(this);
        this.stateService = new StateService(this);
        this.modelService = new ModelService(this);
        this.renderService = new RenderService(this);
        this.layoutService = new LayoutService(this);
        this.viewService = new ViewService(this);
    }

    getID() {
        return this.id;
    }

    getConfig() {
        return this.config;
    }

    getDispatcher() {
        return this.dispatcher;
    }

    getHistoryService() {
        return this.historyService;
    }

    getCursorService() {
        return this.cursorService;
    }

    getStateService() {
        return this.stateService;
    }

    getModelService() {
        return this.modelService;
    }

    getRenderService() {
        return this.renderService;
    }

    getLayoutService() {
        return this.layoutService;
    }

    getViewService() {
        return this.viewService;
    }

    start(markup: string, domContainer: HTMLElement) {
        this.stateService.initialize(markup);
        this.viewService.attachToDOM(domContainer);
    }
}
