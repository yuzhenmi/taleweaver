export default class TextStyle {
  private id: string;
  private font: string;
  private size: number;
  private weight: number;

  constructor(font: string, size: number, weight: number) {
    this.id = JSON.stringify([font, size, weight]);
    this.font = font;
    this.size = size;
    this.weight = weight;
  }

  getID(): string {
    return this.id;
  }

  getFont(): string {
    return this.font;
  }

  getSize(): number {
    return this.size;
  }

  getWeight(): number {
    return this.weight;
  }
}
