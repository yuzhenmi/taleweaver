import Config from './config/Config';
import Cursor from './cursor/Cursor';
import Dispatcher from './dispatch/Dispatcher';
import LayoutEngine from './layout/LayoutEngine';
import ModelEngine from './model/ModelEngine';
import ModelService from './model/ModelService';
import RenderEngine from './render/RenderEngine';
import StateEngine from './state/StateEngine';
import StateService from './state/StateService';
import generateID from './utils/generateID';

export default class Editor {
  protected id: string;
  protected config: Config;
  protected dispatcher: Dispatcher;
  protected cursor: Cursor;
  protected stateService: StateService;
  protected modelService: ModelService;
  protected renderService: RenderService;
  protected layoutService: LayoutService;
  protected viewService: ViewService;
  protected historyService: HistoryService;

  constructor(config: Config, markup: string, domWrapper: HTMLElement) {
    this.id = generateID();
    this.config = config;
    this.dispatcher = new Dispatcher(this);
    this.cursor = new Cursor(this);
    this.stateService = new StateService(this, new StateEngine(this, markup));
    this.modelService = new ModelService(this, new ModelEngine(this));
    this.renderService = new RenderService(this, new RenderEngine(this));
    this.layoutService = new LayoutService(this, new LayoutEngine(this);
    this.viewService = new ViewService(this, new ViewEngine(this, domWrapper));
    this.historyService = new HistoryService(this);
    setTimeout(() => this.getViewService().focus());
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

  getHistoryService() {
    return this.historyService;
  }
}
