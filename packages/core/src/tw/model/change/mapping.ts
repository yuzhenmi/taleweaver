export interface IMapping {
    map(offset: number): number;
}

export class Mapping {
    constructor(protected from: number, protected oldSize: number, protected newSize: number) {}

    map(offset: number) {
        if (offset < this.from) {
            return offset;
        }
        if (offset >= this.from + this.oldSize) {
            return offset - this.oldSize + this.newSize;
        }
        throw new Error('Offset no longer exists.');
    }
}
