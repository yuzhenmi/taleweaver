import { block } from '../../render/dsl';
import { Component } from '../component';

export interface ParagraphProps {}

export const Paragraph: Component<ParagraphProps> = (id, {}, children) => {
    return block(
        id,
        {
            paddingTop: 0,
            paddingBottom: 20,
            paddingLeft: 0,
            paddingRight: 0,
            lineHeight: 1.5,
        },
        children,
    );
};
