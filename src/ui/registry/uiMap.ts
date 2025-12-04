/**
 * Mapping from tool names to their UI component names.
 * Tool names use kebab-case (e.g., 'list-databases')
 * Component names use PascalCase (e.g., 'ListDatabases')
 *
 * The component name corresponds to the folder in src/ui/components/
 * The registry handles resolving this to the built HTML file.
 */
export const uiMap: Record<string, string> = {
    "list-databases": "ListDatabases",
};
