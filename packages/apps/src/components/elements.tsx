import React, { Children, JSX } from "react";

export const AppShell = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={`p-4 min-w-[320px] ${className ? `${className}` : ""}`} {...props} />
);

export const Heading = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
        className={`mb-3 text-sm font-medium text-[color:var(--color-text-primary)] ${className ? `${className}` : ""}`}
        {...props}
    />
);

export const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label
        className={`text-xs font-medium text-[color:var(--color-text-secondary)] ${className ? `${className}` : ""}`}
        {...props}
    />
);

export const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
        className={`w-full rounded-[var(--border-radius-md)] border border-[var(--color-border-primary)] bg-[var(--color-background-secondary)] px-3 py-1.5 font-mono text-sm text-[color:var(--color-text-primary)] shadow-[var(--shadow-sm)] outline-none focus:ring-1 focus:ring-[var(--color-ring-primary)] disabled:opacity-50${className ? ` ${className}` : ""}`}
        {...props}
    />
);

export const Button = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
        className={`cursor-pointer self-start rounded-[var(--border-radius-md)] bg-[var(--color-background-inverse)] px-3 py-1.5 text-sm font-medium text-[color:var(--color-text-inverse)] shadow-[var(--shadow-sm)] outline-none hover:bg-[var(--color-background-inverse-hover)] active:opacity-80 focus:ring-1 focus:ring-[var(--color-ring-primary)] disabled:cursor-not-allowed disabled:opacity-50${className ? ` ${className}` : ""}`}
        {...props}
    />
);

export const Text = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className={`text-sm text-[color:var(--color-text-primary)] ${className ? `${className}` : ""}`} {...props} />
);

export const Loading = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className={`text-xs text-[color:var(--color-text-secondary)] ${className ? `${className}` : ""}`} {...props} />
);

export const ErrorText = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className={`text-xs text-[color:var(--color-text-danger)] ${className ? `${className}` : ""}`} {...props} />
);

export const Success = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className={`text-xs text-[color:var(--color-text-success)] ${className ? ` ${className}` : ""}`} {...props} />
);

export const Code = ({ className, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
        className={`font-mono text-sm text-[color:var(--color-text-primary)] ${className ? `${className}` : ""}`}
        {...props}
    />
);

function trimSpaces(str: string): string {
    return str.replace(/^ +/, "").replace(/ +$/, "");
}

function isBSONValue(value: unknown): value is { _bsontype: string; inspect: () => string } {
    return typeof value === "object" && value !== null && "_bsontype" in value && "inspect" in value;
}

const StripWhitespace = ({ children }: { children: React.ReactNode }) => {
    const cleanChildren = Children.map(children, (child) => {
        if (typeof child === "string") {
            const trimmed = trimSpaces(child);
            if (trimmed) {
                return trimmed;
            }
            return null;
        }
        return child;
    });

    return <>{cleanChildren}</>;
};

const NBSP = "\u00A0";

function indentText(indent: number, noIndent: boolean = false): string {
    if (noIndent) {
        return "";
    }
    return NBSP.repeat(indent * 2);
}

export const PropertyKey = ({ children, className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span
        className={`text-[color:var(--color-text-primary)] font-medium ${className ? ` ${className}` : ""}`}
        {...props}
    >
        {children}
    </span>
);

export const StringValue = ({
    value,
    className,
    ...props
}: { value: string } & React.HTMLAttributes<HTMLSpanElement>) => (
    <span className={`text-[color:var(--color-text-success)] ${className ? ` ${className}` : ""}`} {...props}>
        {JSON.stringify(value)}
    </span>
);

export const NumberValue = ({
    value,
    className,
    ...props
}: { value: number } & React.HTMLAttributes<HTMLSpanElement>) => (
    <span className={`text-[color:var(--color-text-info)] ${className ? ` ${className}` : ""}`} {...props}>
        {value}
    </span>
);

export const BSONValue = ({
    value,
    className,
    ...props
}: { value: { _bsontype: string; inspect: () => string } } & React.HTMLAttributes<HTMLSpanElement>) => (
    <span className={`text-[color:var(--color-text-primary)] ${className ? ` ${className}` : ""}`} {...props}>
        {value.inspect().replace(/^new /, "")}
    </span>
);


export const TreeValue = ({
    value,
    indent,
    noInitialIndent,
}: {
    value: unknown;
    indent: number;
    noInitialIndent?: boolean;
}): JSX.Element => {
    if (Array.isArray(value)) {
        // TODO: special-case empty arrays
        return (
            <StripWhitespace>
                {indentText(indent, noInitialIndent) + "[\n"}
                {value.map((v, i) => (
                    <StripWhitespace>
                        {indentText(indent + 1)}
                        <TreeValue value={v as unknown} indent={indent + 1} noInitialIndent />
                        {i !== value.length - 1 && `,`}
                        {"\n"}
                    </StripWhitespace>
                ))}
                <span>{indentText(indent) + "]"}</span>
            </StripWhitespace>
        );
    }

    if (value && typeof value === "object") {
        if (isBSONValue(value)) {
            return <BSONValue value={value} />;
        }

        // TODO: special-case empty objects
        return (
            <StripWhitespace>
                {indentText(indent, noInitialIndent) + "{\n"}
                {Object.entries(value).map(([k, v], i, arr) => (
                    <StripWhitespace>
                        <PropertyKey>
                            {indentText(indent + 1) + k}:{NBSP}
                        </PropertyKey>
                        <TreeValue value={v as unknown} indent={indent + 1} noInitialIndent />
                        {i !== arr.length - 1 && `,`}
                        {"\n"}
                    </StripWhitespace>
                ))}
                {indentText(indent) + "}"}
            </StripWhitespace>
        );
    }

    if (typeof value === "string") {
        return <StringValue value={value} />;
    }

    if (typeof value === "number") {
        return <NumberValue value={value} />;
    }

    return <span>{JSON.stringify(value)}</span>;
};
