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
};

export type CycloneDxBom = {
    components?: CycloneDxComponent[];
};

export type Dependency = {
    name: string;
    version: string;
};

export type LicenseFile = {
    filename: string;
    content: string;
};

export type DependencyWithLicense = Dependency & {
    license?: string;
    licenses?: string[];
    path?: string;
    licenseFiles?: LicenseFile[];
};

export type Conversion = {
    sbomPath: string;
    outputPath: string;
    enrichedOutputPath: string;
};
