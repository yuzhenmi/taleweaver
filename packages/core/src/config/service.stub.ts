import { Doc } from '../component/components/doc';
import { Paragraph } from '../component/components/paragraph';
import { Color } from '../mark/marks/color';
import { Family } from '../mark/marks/family';
import { Italic } from '../mark/marks/italic';
import { LetterSpacing } from '../mark/marks/letter-spacing';
import { Size } from '../mark/marks/size';
import { Strikethrough } from '../mark/marks/strikethrough';
import { Underline } from '../mark/marks/underline';
import { Weight } from '../mark/marks/weight';
import { ConfigService } from './service';

export function stubConfigService() {
    return new ConfigService(
        {
            commands: {},
            components: { doc: Doc, paragraph: Paragraph },
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
        },
        {},
    );
}
