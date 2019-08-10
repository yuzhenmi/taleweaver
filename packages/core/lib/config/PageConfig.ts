class PageConfig {
    protected pageWidth: number = 816;
    protected pageHeight: number = 1056;
    protected pagePaddingTop: number = 40;
    protected pagePaddingBottom: number = 40;
    protected pagePaddingLeft: number = 40;
    protected pagePaddingRight: number = 40;
    protected shouldTrimPageBottom: boolean = false;

    setPageWidth(pageWidth: number) {
        this.pageWidth = pageWidth;
    }

    getPageWidth() {
        return this.pageWidth;
    }

    setPageHeight(pageHeight: number) {
        this.pageHeight = pageHeight;
    }

    getPageHeight() {
        return this.pageHeight;
    }

    setPagePaddingTop(pagePaddingTop: number) {
        this.pagePaddingTop = pagePaddingTop;
    }

    getPagePaddingTop() {
        return this.pagePaddingTop;
    }

    setPagePaddingBottom(pagePaddingBottom: number) {
        this.pagePaddingBottom = pagePaddingBottom;
    }

    getPagePaddingBottom() {
        return this.pagePaddingBottom;
    }

    setPagePaddingLeft(pagePaddingLeft: number) {
        this.pagePaddingLeft = pagePaddingLeft;
    }

    getPagePaddingLeft() {
        return this.pagePaddingLeft;
    }

    setPagePaddingRight(pagePaddingRight: number) {
        this.pagePaddingRight = pagePaddingRight;
    }

    getPagePaddingRight() {
        return this.pagePaddingRight;
    }

    setShouldTrimPageBottom(shouldTrimPageBottom: boolean) {
        this.shouldTrimPageBottom = shouldTrimPageBottom;
    }

    getShouldTrimPageBottom() {
        return this.shouldTrimPageBottom;
    }
}

export default PageConfig;
