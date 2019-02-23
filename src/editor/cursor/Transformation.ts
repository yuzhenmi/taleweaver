export interface TransformationStep {}

export default class Transformation {
  private steps: TransformationStep[] = [];
  private keepX: boolean;

  constructor(keepX: boolean = false) {
    this.steps = [];
    this.keepX = keepX;
  }

  addStep(step: TransformationStep) {
    this.steps.push(step);
  }

  getSteps(): TransformationStep[] {
    return this.steps;
  }

  getKeepX(): boolean {
    return this.keepX;
  }
}
