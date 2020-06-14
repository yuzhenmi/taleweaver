import { ICursorChange, ICursorChangeResult } from '../cursor/change/change';
import { IModelChange, IModelChangeResult } from '../model/change/change';

export type IChange = IModelChange | ICursorChange;

export type IChangeResult = IModelChangeResult | ICursorChangeResult;
