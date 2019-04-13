abstract class Operation {

  abstract getDelta(): number;

  abstract offsetBy(delta: number): void;
}

export default Operation;
