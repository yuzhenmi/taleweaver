import { IRenderService } from '../../render/service';

export interface IMapping {
    map(offset: number): number;
    mapRender(offset: number, renderService: IRenderService): number;
    reverse(): IMapping;
}

export class Mapping {
    constructor(protected from: number, protected oldSize: number, protected newSize: number) {}

    map(offset: number) {
        if (offset <= this.from) {
            return offset;
        }
        if (offset >= this.from + this.oldSize) {
            return offset - this.oldSize + this.newSize;
        }
        throw new Error('Offset no longer exists.');
    }

    mapRender(offset: number, renderService: IRenderService) {
        const modelOffset = renderService.convertOffsetToModelOffset(offset);
        const newModelOffset = this.map(modelOffset);
        return renderService.convertModelOffsetToOffset(newModelOffset);
    }

    reverse() {
        return new Mapping(this.from, this.newSize, this.oldSize);
    }
}
