export interface IResource {
    register(server: unknown): void;
}

export type IResources = readonly IResource[];
