import { DocComponent } from '../component/components/doc';
import { ParagraphComponent } from '../component/components/paragraph';
import { TextComponent } from '../component/components/text';
import { IConfig } from './config';
import { IConfigService } from './service';

export class ConfigServiceStub implements IConfigService {
    protected config: IConfig;

    constructor() {
        this.config = {
            commands: {},
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
