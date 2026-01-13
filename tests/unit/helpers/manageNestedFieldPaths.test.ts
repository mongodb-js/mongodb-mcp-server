import { describe, expect, it } from "vitest";
import { setFieldPath } from "../../../src/helpers/manageNestedFieldPaths.js";

describe("manageNestedFieldPaths", () => {
    describe("setFieldPath", () => {
        it("sets a top-level field", () => {
            const doc: Record<string, unknown> = {};
            setFieldPath(doc, "name", "test");
            expect(doc).toEqual({ name: "test" });
        });

        it("updates a nested field on existing object", () => {
            const doc: Record<string, unknown> = { info: { title: "Old Title" } };
            setFieldPath(doc, "info.title", "New Title");
            expect(doc).toEqual({ info: { title: "New Title" } });
        });

        it("creates intermediate objects for nested path", () => {
            const doc: Record<string, unknown> = {};
            setFieldPath(doc, "info.titleEmbeddings", [1, 2, 3]);
            expect(doc).toEqual({ info: { titleEmbeddings: [1, 2, 3] } });
        });

        it("creates deeply nested path", () => {
            const doc: Record<string, unknown> = {};
            setFieldPath(doc, "a.b.c.d", "deep value");
            expect(doc).toEqual({ a: { b: { c: { d: "deep value" } } } });
        });

        it("preserves existing sibling fields", () => {
            const doc: Record<string, unknown> = { info: { title: "The Matrix" } };
            setFieldPath(doc, "info.titleEmbeddings", [1, 2, 3]);
            expect(doc).toEqual({ info: { title: "The Matrix", titleEmbeddings: [1, 2, 3] } });
        });

        it("throws when intermediate path is a string", () => {
            const doc: Record<string, unknown> = { info: "string value" };
            expect(() => setFieldPath(doc, "info.title", "test")).toThrow(
                "Cannot set field at provided path: intermediate path 'info' is not an object."
            );
        });

        it("throws when intermediate path is a number", () => {
            const doc: Record<string, unknown> = { info: 123 };
            expect(() => setFieldPath(doc, "info.title", "test")).toThrow(
                "Cannot set field at provided path: intermediate path 'info' is not an object."
            );
        });

        it("throws when intermediate path is an array", () => {
            const doc: Record<string, unknown> = { info: [1, 2, 3] };
            expect(() => setFieldPath(doc, "info.title", "test")).toThrow(
                "Cannot set field at provided path: intermediate path 'info' is not an object."
            );
        });

        it("creates object when intermediate path is null", () => {
            const doc: Record<string, unknown> = { info: null };
            setFieldPath(doc, "info.title", "test");
            expect(doc).toEqual({ info: { title: "test" } });
        });

        it("creates object when intermediate path is undefined", () => {
            const doc: Record<string, unknown> = { info: undefined };
            setFieldPath(doc, "info.title", "test");
            expect(doc).toEqual({ info: { title: "test" } });
        });

        it("sets array as value", () => {
            const doc: Record<string, unknown> = {};
            const embeddings = [0.1, 0.2, 0.3, 0.4];
            setFieldPath(doc, "data.embeddings", embeddings);
            expect(doc).toEqual({ data: { embeddings: [0.1, 0.2, 0.3, 0.4] } });
        });

        it("sets object as value", () => {
            const doc: Record<string, unknown> = {};
            setFieldPath(doc, "metadata", { count: 5, active: true });
            expect(doc).toEqual({ metadata: { count: 5, active: true } });
        });

        it("creates own properties for __proto__, constructor without polluting prototypes", () => {
            const doc: Record<string, unknown> = {};

            // Set fields that could potentially cause prototype pollution
            setFieldPath(doc, "__proto__.nested", "value1");
            setFieldPath(doc, "info.constructor", "value2");

            // Verify own properties were created
            expect(Object.prototype.hasOwnProperty.call(doc, "__proto__")).toBe(true);
            expect((doc["__proto__"] as Record<string, unknown>).nested).toBe("value1");
            expect((doc.info as Record<string, unknown>).constructor).toBe("value2");
            expect(JSON.stringify(doc)).toEqual('{"__proto__":{"nested":"value1"},"info":{"constructor":"value2"}}');
        });

        it("throws for invalid field paths", () => {
            const doc: Record<string, unknown> = {};
            const invalidPaths = [
                "",
                " ",
                "  ",
                "\t",
                "a. .b",
                "a.\t.b",
                ".a.b",
                "a.b.",
                "a..b",
                "a.b.c.",
                "a..b.c",
                ".",
            ];

            for (const path of invalidPaths) {
                expect(
                    () => setFieldPath(doc, path, "value"),
                    `Expected setFieldPath to throw for path '${path}'`
                ).toThrow(`Invalid field path: '${path}'`);
            }
        });

        it("throws when field path exceeds maximum depth", () => {
            const doc: Record<string, unknown> = {};
            const deepPath = Array.from({ length: 101 }, (_, i) => `level${i}`).join(".");
            expect(() => setFieldPath(doc, deepPath, "value")).toThrow(
                `Field path "${deepPath}" has too many nested levels (maximum 100 allowed).`
            );
        });
    });
});
