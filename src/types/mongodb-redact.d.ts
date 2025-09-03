declare module "mongodb-redact" {
    export declare const SECRET_KIND: readonly [
        "base64",
        "private key",
        "user",
        "password",
        "email",
        "ip",
        "url",
        "mongodb uri",
    ];

    export type SecretKind = (typeof SECRET_KIND)[number];
    export type Secret = {
        readonly value: string;
        readonly kind: SecretKind;
    };

    export declare function redact<T>(message: T, secrets?: Secret[] | undefined): T;
    export default redact;
}
