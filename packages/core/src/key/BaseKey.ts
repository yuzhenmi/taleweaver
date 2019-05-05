export default abstract class BaseKey {
  protected code: string;

  constructor(code: string) {
    this.code = code;
  }

  getCode(): string {
    return this.code;
  }
}