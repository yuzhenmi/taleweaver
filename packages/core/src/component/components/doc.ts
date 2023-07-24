import { doc } from '../../render/dsl';
import { Component } from '../component';

export interface DocProps {
    pageWidth: number;
    pageHeight: number;
    pagePaddingTop: number;
    pagePaddingBottom: number;
    pagePaddingLeft: number;
    pagePaddingRight: number;
}

export const Doc: Component<DocProps> = (
    id,
    {
        pageWidth = 816,
        pageHeight = 1056,
        pagePaddingTop = 40,
        pagePaddingBottom = 40,
        pagePaddingLeft = 40,
        pagePaddingRight = 40,
    },
    children,
) => {
    return doc(
        id,
        {
            pageWidth,
            pageHeight,
            pagePaddingTop,
            pagePaddingBottom,
            pagePaddingLeft,
            pagePaddingRight,
        },
        children,
    );
};
