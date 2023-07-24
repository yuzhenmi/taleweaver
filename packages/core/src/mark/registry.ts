import { MarkType } from './mark';

export interface IMarkTypeRegistry {
    registerMarkType(markType: MarkType<any>): void;
    getMarkType<TAttributes>(markTypeId: string): MarkType<TAttributes>;
}

export class MarkTypeRegistry implements IMarkTypeRegistry {
    protected markTypesMap: Map<string, MarkType<any>> = new Map();

    registerMarkType(markType: MarkType<any>) {
        this.markTypesMap.set(markType.id, markType);
    }

    getMarkType<TAttributes>(markTypeId: string) {
        const markType = this.markTypesMap.get(markTypeId);
        if (!markType) {
            throw new Error(`Mark type ${markTypeId} is not registered.`);
        }
        return markType as MarkType<TAttributes>;
    }
}
