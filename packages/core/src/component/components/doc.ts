import { DocComponent as AbstractDocComponent } from '../component';

export interface IDocAttributes {
    pageWidth: number;
    pageHeight: number;
    pagePaddingTop: number;
    pagePaddingBottom: number;
    pagePaddingLeft: number;
    pagePaddingRight: number;
}

export class DocComponent extends AbstractDocComponent<IDocAttributes> {
    render(attributes: Partial<IDocAttributes>) {
        return {
            style: {
                pageWidth: attributes.pageWidth ?? 816,
                pageHeight: attributes.pageHeight ?? 1056,
                pagePaddingTop: attributes.pagePaddingTop ?? 40,
                pagePaddingBottom: attributes.pagePaddingBottom ?? 40,
                pagePaddingLeft: attributes.pagePaddingLeft ?? 40,
                pagePaddingRight: attributes.pagePaddingRight ?? 40,
            },
        };
    }
}
