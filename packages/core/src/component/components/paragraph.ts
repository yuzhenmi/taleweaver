import { BlockComponent } from '../component';

export interface ParagraphAttributes {}

export class ParagraphComponent extends BlockComponent<ParagraphAttributes> {
    render(attributes: Partial<ParagraphAttributes>) {
        return {
            style: {
                paddingTop: 0,
                paddingBottom: 20,
                paddingLeft: 0,
                paddingRight: 0,
                lineHeight: 1.5,
            },
        };
    }
}
