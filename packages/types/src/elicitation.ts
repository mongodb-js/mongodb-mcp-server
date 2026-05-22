export type ElicitedInputResult =
    | { accepted: true; fields: Record<string, string> }
    | { accepted: false; fields?: undefined };

export interface IElicitation {
    supportsElicitation(): boolean;
    requestConfirmation(message: string): Promise<boolean>;
    requestInput(message: string, schema: unknown): Promise<ElicitedInputResult>;
}
