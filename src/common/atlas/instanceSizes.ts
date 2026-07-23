import { z } from "zod";

// Standard M-series sizes for create/scale, capped at M80 (excludes NVMe/Gen2/high-mem/R-series).
export const STANDARD_INSTANCE_SIZES = ["M10", "M20", "M30", "M40", "M50", "M60", "M80"] as const;

export const standardInstanceSizeEnum = z.enum(STANDARD_INSTANCE_SIZES);

export type StandardInstanceSize = z.infer<typeof standardInstanceSizeEnum>;

export function isStandardInstanceSize(size: string): size is StandardInstanceSize {
    return (STANDARD_INSTANCE_SIZES as readonly string[]).includes(size);
}

// Two standard tiers above `size`, capped at M80.
export function twoStandardTiersAbove(size: StandardInstanceSize): StandardInstanceSize {
    const idx = STANDARD_INSTANCE_SIZES.indexOf(size);
    return STANDARD_INSTANCE_SIZES[Math.min(idx + 2, STANDARD_INSTANCE_SIZES.length - 1)] ?? "M80";
}
