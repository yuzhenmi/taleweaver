export function testDeepEquality(thing1: any, thing2: any) {
    return JSON.stringify(thing1) === JSON.stringify(thing2);
}
