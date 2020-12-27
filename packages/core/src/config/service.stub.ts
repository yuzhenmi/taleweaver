import { DocComponent } from '../component/components/doc';
import { ParagraphComponent } from '../component/components/paragraph';
import { Color } from '../mark/marks/color';
import { Family } from '../mark/marks/family';
import { Italic } from '../mark/marks/italic';
import { LetterSpacing } from '../mark/marks/letter-spacing';
import { Size } from '../mark/marks/size';
import { Strikethrough } from '../mark/marks/strikethrough';
import { Underline } from '../mark/marks/underline';
import { Weight } from '../mark/marks/weight';
import { IConfig } from './config';
import { IConfigService } from './service';

export class ConfigServiceStub implements IConfigService {
    protected config: IConfig;

    constructor() {
        this.config = {
            commands: {},
            components: [
                new DocComponent('doc'),
                new ParagraphComponent('paragraph'),
            ],
            markTypes: [
                new Color('color'),
                new Family('family'),
                new Italic('italic'),
                new LetterSpacing('letterSpacing'),
                new Size('size'),
                new Strikethrough('strikethrough'),
                new Underline('underline'),
                new Weight('weight'),
            ],
            cursor: {
                disable: false,
                caretColor: 'black',
                caretInactiveColor: 'grey',
                selectionColor: 'blue',
                selectionInactiveColor: 'cyan',
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
