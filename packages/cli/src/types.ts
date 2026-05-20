export type Console = {
    log(message: string): void;
    error(message: string): void;
    warn(message: string): void;
};

export type OnExit = (exitCode: number) => void;
