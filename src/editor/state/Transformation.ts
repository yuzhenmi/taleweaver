export interface TransformationStep {

  getType(): string;
}

export default class Transformation {
  private steps: TransformationStep[] = [];

  constructor() {
    this.steps = [];
  }

  addStep(step: TransformationStep) {
    this.steps.push(step);
  }

  getSteps(): TransformationStep[] {
    return this.steps;
  }
}
