import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  useMemo,
  ReactNode
} from 'react';

function createSelectorProxy(): {
  proxy: Record<string, any>;
  getPath: () => string[];
} {
  const path: string[] = [];

  const proxy: Record<string, any> = new Proxy(
    {},
    {
      get(_, key: string) {
        path.push(key);
        return proxy;
      }
    }
  );

  return {
    proxy,
    getPath: () => [...path]
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

    const get = useMemo(() => () => store.current, []);

    const set = useMemo(() => {
      return (value: Partial<Store> | ((prev: Store) => Partial<Store>)) => {
        const newState =
          typeof value === 'function' ? value(store.current) : value;
        store.current = { ...store.current, ...newState };
        subscribers.current.forEach(cb => cb());
      };
    }, []);

    const subscribe = useMemo(() => {
      return (cb: () => void) => {
        subscribers.current.add(cb);
        return () => subscribers.current.delete(cb);
      };
    }, []);

    const reset = useMemo(() => {
      return () => {
        store.current = { ...initialState };
        subscribers.current.forEach(cb => cb());
      };
    }, []);

    return { get, set, subscribe, reset };
  }

  const StoreContext = createContext<ReturnType<typeof useStoreData> | null>(
    null
  );

  function Provider({ children }: { children: ReactNode }) {
    const data = useStoreData(); // hook not conditional
    const storeRef = useRef(data); // keep it stable across renders
    return (
      <StoreContext.Provider value={storeRef.current}>
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

    const { proxy, getPath } = useMemo(() => createSelectorProxy(), []);

    // Safe from TS error — block form doesn't require return
    useMemo(() => {
      selector(proxy as Store);
    }, [selector]);

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
      [store, JSON.stringify(trackedPath)]
    ); // path is the key to selector uniqueness

    return [state, setState];
  }

  function useSetStore() {
    const store = useContext(StoreContext);
    if (!store) throw new Error('Store not found');
    return store.set;
  }

  function useGetStore() {
    const store = useContext(StoreContext);
    if (!store) throw new Error('Store not found');
    return store.get;
  }

  function useResetStore() {
    const store = useContext(StoreContext);
    if (!store) throw new Error('Store not found');
    return store.reset;
  }

  return {
    Provider,
    useStore,
    useSetStore,
    useGetStore,
    useResetStore
  };
}
