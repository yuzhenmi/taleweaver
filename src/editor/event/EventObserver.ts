import TaleWeaver from '../TaleWeaver';
import Event from './Event';

export default abstract class EventObserver {
  protected taleWeaver: TaleWeaver;

  constructor(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;
  }

  abstract onEvent(event: Event): void;
}
