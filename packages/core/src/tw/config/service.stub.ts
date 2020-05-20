import { DocComponent } from '../component/components/doc';
import { ParagraphComponent } from '../component/components/paragraph';
import { TextComponent } from '../component/components/text';
import { TextServiceStub } from '../text/service.stub';
import { IConfig } from './config';
import { IConfigService } from './service';

export class ConfigServiceStub implements IConfigService {
    protected config: IConfig;

    constructor() {
        const textService = new TextServiceStub();
        this.config = {
            commands: {},
            components: {
                doc: new DocComponent('doc', this),
                paragraph: new ParagraphComponent('paragraph'),
                text: new TextComponent('text', textService),
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
                width: 816,
                height: 1056,
                paddingTop: 40,
                paddingBottom: 40,
                paddingLeft: 40,
                paddingRight: 40,
            },
        };
    }

    getConfig() {
        return this.config;
    }
}
