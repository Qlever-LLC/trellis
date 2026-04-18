export function createLiveObjectProxy<T extends object>(
  getCurrent: () => T,
): T {
  return new Proxy({}, {
    get(_target, prop, _receiver) {
      const current = getCurrent();
      const value = Reflect.get(current, prop);
      if (typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => Reflect.apply(value, current, args);
    },
    has(_target, prop) {
      return prop in getCurrent();
    },
    ownKeys() {
      return Reflect.ownKeys(getCurrent());
    },
    getOwnPropertyDescriptor(_target, prop) {
      const descriptor = Object.getOwnPropertyDescriptor(getCurrent(), prop);
      return descriptor ?? {
        configurable: true,
        enumerable: true,
        writable: false,
        value: Reflect.get(getCurrent(), prop),
      };
    },
  }) as T;
}
