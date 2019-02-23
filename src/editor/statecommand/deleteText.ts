import TaleWeaver from '../TaleWeaver';
import StateCommand from './StateCommand';
import Transformation from '../state/Transformation';
import Delete from '../state/transformationsteps/Delete';

export default function deleteText(positionFrom: number, positionTo: number): StateCommand {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    transformation.addStep(new Delete(positionFrom, positionTo));
    return transformation;
  };
}
