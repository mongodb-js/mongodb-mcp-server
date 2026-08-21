import type { Collection, Document } from "mongodb";

export async function freshInsertDocuments({
    collection,
    count,
    documentMapper = (index): Document => ({ value: index }),
}: {
    collection: Collection<Document>;
    count: number;
    documentMapper?: (index: number) => Document;
}): Promise<void> {
    await collection.drop();
    const documents = Array.from({ length: count }).map((_, idx) => documentMapper(idx));
    await collection.insertMany(documents);
}
