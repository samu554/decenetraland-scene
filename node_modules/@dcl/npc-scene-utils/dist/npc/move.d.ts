/// <reference types="dcl" />
import { NPCLerpType } from '../utils/types';
export declare class NPCLerpData {
    path: Vector3[];
    origin: number;
    target: number;
    fraction: number;
    totalDuration: number;
    speed: number[];
    loop: boolean;
    type: NPCLerpType;
    onFinishCallback?: () => void;
    onReachedPointCallback?: () => void;
    constructor(path: Vector3[], type?: NPCLerpType);
    setIndex(index: number): void;
}
export declare class NPCWalkSystem implements ISystem {
    static _instance: NPCWalkSystem | null;
    update(dt: number): void;
    static createAndAddToEngine(): NPCWalkSystem;
    private constructor();
}
