import Editor from '../../Editor';
import Command from './Command';
import Transformation from '../Transformation';
import Delete from '../operations/Delete';

export default function deleteText(positionFrom: number, positionTo: number): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    transformation.addOperation(new Delete(positionFrom, positionTo));
    return transformation;
  };
}
