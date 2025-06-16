import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore
} from 'react';
import type { ReactNode } from 'react';

export function createSelectorProxy(): {
  proxy: Record<string, any>;
  getPath: () => string[];
} {
  const lastPath: string[] = [];

  let proxy: Record<string, any>; // <-- Declare before initializing

  proxy = new Proxy(
    {},
    {
      get(_, key: string) {
        lastPath.push(key);
        return proxy;
      }
    }
  );

  return {
    proxy,
    getPath: () => [...lastPath]
  };
}

function getNestedValue<T extends Record<string, any>>(
  obj: T,
  path: string[]
): any {
  return path.reduce((acc, key) => acc?.[key], obj);
}

function setNestedValue<T extends Record<string, any>>(
  obj: T,
  path: string[],
  value: any
): T {
  const newObj = { ...obj };
  let temp: any = newObj;

  path.forEach((key, index) => {
    if (index === path.length - 1) {
      temp[key] = typeof value === 'function' ? value(temp[key]) : value;
    } else {
      temp[key] = { ...temp[key] };
      temp = temp[key];
    }
  });

  return newObj;
}

export function createStore<Store extends Record<string, any>>(
  initialState: Store
) {
  function useStoreData() {
    const store = useRef<Store>({ ...initialState });
    const subscribers = useRef(new Set<() => void>());

    const get = useCallback(() => store.current, []);

    const set = useCallback(
      (value: Partial<Store> | ((prev: Store) => Partial<Store>)) => {
        const newState =
          typeof value === 'function' ? value(store.current) : value;
        store.current = { ...store.current, ...newState };
        subscribers.current.forEach(cb => cb());
      },
      []
    );

    const subscribe = useCallback((cb: () => void) => {
      subscribers.current.add(cb);
      return () => subscribers.current.delete(cb);
    }, []);

    return { get, set, subscribe };
  }

  const StoreContext = createContext<ReturnType<typeof useStoreData> | null>(
    null
  );

  function Provider({ children }: { children: ReactNode }) {
    return (
      <StoreContext.Provider value={useStoreData()}>
        {children}
      </StoreContext.Provider>
    );
  }

  function useStore<SelectorOutput>(
    selector: (store: Store) => SelectorOutput
  ): [
    SelectorOutput,
    (
      value:
        | Partial<SelectorOutput>
        | ((prev: SelectorOutput) => Partial<SelectorOutput>)
    ) => void
  ] {
    const store = useContext(StoreContext);
    if (!store) throw new Error('Store not found');

    const { proxy, getPath } = createSelectorProxy();
    selector(proxy as Store);
    const trackedPath = getPath();

    const state = useSyncExternalStore(store.subscribe, () =>
      getNestedValue(store.get(), trackedPath)
    );

    const setState = useCallback(
      (
        value:
          | Partial<SelectorOutput>
          | ((prev: SelectorOutput) => Partial<SelectorOutput>)
      ) => {
        store.set(prev => setNestedValue(prev, trackedPath, value));
      },
      [store, JSON.stringify(trackedPath), trackedPath]
    );

    return [state, setState];
  }

  function useSetStore() {
    const store = useContext(StoreContext);
    if (!store) throw new Error('Store not found');
    return store.set;
  }

  return {
    Provider,
    useStore,
    useSetStore
  };
}
