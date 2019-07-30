import Config from './config/Config';
import Cursor from './cursor/Cursor';
import Dispatcher from './dispatch/Dispatcher';
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
    protected cursor: Cursor;
    // protected historyService: HistoryService;
    protected stateService: StateService;
    protected modelService: ModelService;
    protected renderService: RenderService;
    protected layoutService: LayoutService;
    protected viewService: ViewService;

    constructor(config: Config, markup: string) {
        this.id = generateID();
        this.config = config;
        this.dispatcher = new Dispatcher(this);
        this.cursor = new Cursor(this);
        // this.historyService = new HistoryService(this);
        this.stateService = new StateService(this, markup);
        this.modelService = new ModelService(this);
        this.renderService = new RenderService(this);
        this.layoutService = new LayoutService(this);
        this.viewService = new ViewService(this);
        this.stateService.initialize(markup);
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

    getCursor() {
        return this.cursor;
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

    // getHistoryService() {
    //   return this.historyService;
    // }
}
