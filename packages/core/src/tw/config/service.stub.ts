import { DocComponent } from '../component/components/doc';
import { ParagraphComponent } from '../component/components/paragraph';
import { TextComponent } from '../component/components/text';
import { DOMServiceStub } from '../dom/service.stub';
import { TextServiceStub } from '../text/service.stub';
import { IConfig } from './config';
import { IConfigService } from './service';

export class ConfigServiceStub implements IConfigService {
    protected config: IConfig;

    constructor() {
        const textService = new TextServiceStub();
        const domService = new DOMServiceStub();
        this.config = {
            commands: {},
            components: {
                doc: new DocComponent('doc', domService, this),
                paragraph: new ParagraphComponent('paragraph', domService),
                text: new TextComponent('text', domService, textService),
            },
            cursor: {
                disable: false,
            },
            history: {
                collapseThreshold: 500,
                maxCollapseDuration: 2000,
            },
            keyBindings: {
                common: {},
                macos: {},
                windows: {},
                linux: {},
            },
            page: {
                width: 800,
                height: 1000,
                paddingTop: 50,
                paddingBottom: 50,
                paddingLeft: 50,
                paddingRight: 50,
            },
        };
    }

    getConfig() {
        return this.config;
    }
}
