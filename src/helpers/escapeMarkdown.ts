/**
 * Escapes markdown and HTML metacharacters in a string.
 */
export function escapeMarkdown(value: string): string {
    return value.replace(/[\\`*_{}[\]()<>#+\-.!|]/g, "\\$&");
}
