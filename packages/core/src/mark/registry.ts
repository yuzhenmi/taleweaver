import { IMarkType } from './mark';

export interface IMarkTypeRegistry {
    registerMarkType(markType: IMarkType<any>): void;
    getMarkType<TAttributes>(markTypeId: string): IMarkType<TAttributes>;
}

export class MarkTypeRegistry implements IMarkTypeRegistry {
    protected markTypesMap: Map<string, IMarkType<any>> = new Map();

    registerMarkType(markType: IMarkType<any>) {
        this.markTypesMap.set(markType.id, markType);
    }

    getMarkType<TAttributes>(markTypeId: string) {
        const markType = this.markTypesMap.get(markTypeId);
        if (!markType) {
            throw new Error(`Mark type ${markTypeId} is not registered.`);
        }
        return markType as IMarkType<TAttributes>;
    }
}
