import { describe, expect, it } from "vitest";
import { deleteFieldPath, setFieldPath } from "../../../src/helpers/manageNestedFieldPaths.js";

describe("manageNestedFieldPaths", () => {
    describe("deleteFieldPath", () => {
        it("deletes a top-level field", () => {
            const doc = { name: "test", age: 25 };
            deleteFieldPath(doc, "name");
            expect(doc).toEqual({ age: 25 });
        });

        it("deletes a nested field", () => {
            const doc = { info: { title: "The Matrix", year: 1999 } };
            deleteFieldPath(doc, "info.title");
            expect(doc).toEqual({ info: { year: 1999 } });
        });

        it("deletes a deeply nested field", () => {
            const doc = { a: { b: { c: { d: "value" } } } };
            deleteFieldPath(doc, "a.b.c.d");
            expect(doc).toEqual({ a: { b: { c: {} } } });
        });

        it("does nothing if field does not exist", () => {
            const doc = { name: "test" };
            deleteFieldPath(doc, "nonexistent");
            expect(doc).toEqual({ name: "test" });
        });

        it("does nothing if nested path does not exist", () => {
            const doc = { info: { title: "test" } };
            deleteFieldPath(doc, "info.nonexistent.deep");
            expect(doc).toEqual({ info: { title: "test" } });
        });

        it("does nothing if intermediate path is not an object", () => {
            const doc = { info: { title: "string value" } };
            deleteFieldPath(doc, "info.title.name");
            expect(doc).toEqual({ info: { title: "string value" } });
        });

        it("handles empty document", () => {
            const doc = {};
            deleteFieldPath(doc, "any.path");
            expect(doc).toEqual({});
        });
    });

    describe("setFieldPath", () => {
        it("sets a top-level field", () => {
            const doc: Record<string, unknown> = {};
            setFieldPath(doc, "name", "test");
            expect(doc).toEqual({ name: "test" });
        });

        it("sets a nested field on existing object", () => {
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
                "Cannot set field at path 'info.title': intermediate path 'info' is not an object."
            );
        });

        it("throws when intermediate path is a number", () => {
            const doc: Record<string, unknown> = { info: 123 };
            expect(() => setFieldPath(doc, "info.title", "test")).toThrow(
                "Cannot set field at path 'info.title': intermediate path 'info' is not an object."
            );
        });

        it("throws when intermediate path is an array", () => {
            const doc: Record<string, unknown> = { info: [1, 2, 3] };
            expect(() => setFieldPath(doc, "info.title", "test")).toThrow(
                "Cannot set field at path 'info.title': intermediate path 'info' is not an object."
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
    });
});
