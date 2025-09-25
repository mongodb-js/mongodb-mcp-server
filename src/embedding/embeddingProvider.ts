export interface EmbeddingProvider {
  name: string;
  embed(input: string[]): Promise<number[][]>;
}
