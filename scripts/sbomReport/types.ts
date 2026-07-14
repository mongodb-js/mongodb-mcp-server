export type CycloneDxLicense = {
    license?: {
        id?: string;
        name?: string;
    };
    expression?: string;
};

export type CycloneDxComponent = {
    name: string;
    version: string;
    group?: string;
    type?: string;
    licenses?: CycloneDxLicense[];
    purl?: string;
};

export type CycloneDxBom = {
    components?: CycloneDxComponent[];
};

export type LicenseFile = {
    filename: string;
    content: string;
};

export type DependencyWithLicense = {
    name: string;
    version: string;
    license?: string;
    licenses?: string[];
    path?: string;
    licenseFiles?: LicenseFile[];
};

export type Conversion = {
    prod: boolean;
    outputPath: string;
    rawOutputPath: string;
};
