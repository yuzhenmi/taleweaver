export function testDeepEquality(thing1: any, thing2: any) {
    return JSON.stringify(thing1) === JSON.stringify(thing2);
}

export function testArrayEquality<T>(arr1: T[], arr2: T[]) {
    if (arr1.length !== arr2.length) {
        return false;
    }
    for (let n = 0, nn = arr1.length; n < nn; n++) {
        if (arr1[n] !== arr2[n]) {
            return false;
        }
    }
    return true;
}

export function testObjectEquality(obj1: Object, obj2: Object) {
    const obj1Keys = Object.keys(obj1).sort();
    const obj2Keys = Object.keys(obj2).sort();
    if (!testArrayEquality(obj1Keys, obj2Keys)) {
        return false;
    }
    for (let n = 0, nn = obj1Keys.length; n < nn; n++) {
        if ((obj1 as any)[obj1Keys[n]] !== (obj2 as any)[obj2Keys[n]]) {
            return false;
        }
    }
    return true;
}
