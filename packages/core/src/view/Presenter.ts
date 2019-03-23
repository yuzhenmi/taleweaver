import Config from '../Config';
import DocLayout from '../layout/DocLayout';
import PageLayout from '../layout/PageLayout';
import BlockBox from '../layout/BlockBox';
import LineBox from '../layout/LineBox';
import InlineBox from '../layout/InlineBox';
import InputManager from '../input/InputManager';
import EventObserver from './EventObserver';
import DocView from './DocView';
import PageView from './PageView';
import BlockView from './BlockView';
import LineView from './LineView';
import InlineView from './InlineView';

export type OnMountedSubscriber = () => void;

export default class Presenter {
  protected config: Config;
  protected docLayout: DocLayout;
  protected inputManager: InputManager;
  protected eventObserver?: EventObserver;
  protected docView: DocView;
  protected onMountedSubscribers: OnMountedSubscriber[];

  constructor(config: Config, docLayout: DocLayout, inputManager: InputManager) {
    this.config = config;
    this.docLayout = docLayout;
    this.inputManager = inputManager;
    this.docView = new DocView(docLayout);
    this.onMountedSubscribers = [];
  }

  mount(domWrapper: HTMLElement) {
    let offset = 0;
    this.docLayout.getChildren().forEach(child => {
      this.docView.insertChild(this.buildPageView(child), offset)
      offset += 1;
    });
    domWrapper.appendChild(this.docView.getDOMContainer());

    // Initialize event observer
    this.eventObserver = new EventObserver(this, this.inputManager);

    // Notify subscribers
    this.onMountedSubscribers.forEach(subscriber => subscriber());
  }

  getDocView(): DocView {
    return this.docView;
  }

  subscribeOnMounted(subscriber: OnMountedSubscriber) {
    this.onMountedSubscribers.push(subscriber);
  }

  getPageDOMContentContainer(pageOffset: number): HTMLDivElement {
    const pages = this.docView.getChildren();
    if (pageOffset < 0 || pageOffset >= pages.length) {
      throw new Error(`Page offset ${pageOffset} is out of range.`);
    }
    return pages[pageOffset].getDOMContentContainer();
  }

  protected buildPageView(pageLayout: PageLayout): PageView {
    const view = new PageView(pageLayout);
    let offset = 0;
    pageLayout.getChildren().forEach(child => {
      view.insertChild(this.buildBlockView(child), offset);
      offset += 1;
    });
    return view;
  }

  protected buildBlockView(blockBox: BlockBox): BlockView {
    const ViewClass = this.config.getViewClass(blockBox.getType());
    const view = new ViewClass(blockBox);
    if (!(view instanceof BlockView)) {
      throw new Error(`Error building block view, view built from box of type ${blockBox.getType()} is not block view.`);
    }
    let offset = 0;
    blockBox.getChildren().forEach(child => {
      view.insertChild(this.buildLineView(child), offset);
      offset += 1;
    });
    return view;
  }

  protected buildLineView(lineBox: LineBox): LineView {
    const view = new LineView(lineBox);
    let offset = 0;
    lineBox.getChildren().forEach(child => {
      view.insertChild(this.buildInlineView(child), offset);
      offset += 1;
    });
    return view;
  }

  protected buildInlineView(inlineBox: InlineBox): InlineView {
    const ViewClass = this.config.getViewClass(inlineBox.getType());
    const view = new ViewClass(inlineBox);
    if (!(view instanceof InlineView)) {
      throw new Error(`Error building inline view, view built from box of type ${inlineBox.getType()} is not block view.`);
    }
    return view;
  }
}
