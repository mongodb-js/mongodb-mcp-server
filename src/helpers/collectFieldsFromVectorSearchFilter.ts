// Based on -
// https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/#mongodb-vector-search-pre-filter
const ALLOWED_LOGICAL_OPERATORS = ["$not", "$nor", "$and", "$or"];

export function collectFieldsFromVectorSearchFilter(filter: unknown): string[] {
    if (!filter || typeof filter !== "object" || !Object.keys(filter).length) {
        return [];
    }

    const collectedFields = Object.entries(filter).reduce<string[]>((collectedFields, [maybeField, fieldMQL]) => {
        if (ALLOWED_LOGICAL_OPERATORS.includes(maybeField) && Array.isArray(fieldMQL)) {
            return fieldMQL.flatMap((mql) => collectFieldsFromVectorSearchFilter(mql));
        }

        if (!ALLOWED_LOGICAL_OPERATORS.includes(maybeField)) {
            collectedFields.push(maybeField);
        }
        return collectedFields;
    }, []);

    return Array.from(new Set(collectedFields));
}
