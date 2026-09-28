"use client";

import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/** True after hydration, without scheduling a state update from an effect. */
export function useClientMounted(): boolean {
    return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
