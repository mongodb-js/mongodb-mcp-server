import z4 from "zod/v4";
import z3 from "zod/v3";

const similarityValues = ["cosine", "euclidean", "dotProduct"] as const;

export const similarityEnumV4 = z4.enum(similarityValues);
export const similarityEnum = z3.enum(similarityValues);
