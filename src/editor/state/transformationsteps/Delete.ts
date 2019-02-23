import { TransformationStep } from '../Transformation';

export default class Delete implements TransformationStep {
  private offsetFrom: number;
  private offsetTo: number;

  constructor(offsetFrom: number, offsetTo: number) {
    this.offsetFrom = offsetFrom;
    this.offsetTo = offsetTo;
  }

  getType(): string {
    return 'Delete';
  }

  getOffsetFrom(): number {
    return this.offsetFrom;
  }

  getOffsetTo(): number {
    return this.offsetTo;
  }
}
