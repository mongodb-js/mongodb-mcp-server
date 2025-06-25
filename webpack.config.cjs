const path = require("path");
const webpack = require("webpack");
const nodeExternals = require("webpack-node-externals");

module.exports = {
    mode: "production",
    target: "node",
    devtool: "source-map",
    entry: {
        cli: path.resolve(__dirname, "src", "cli.ts"),
        lib: path.resolve(__dirname, "src", "lib.ts"),
    },
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "[name].cjs",
        libraryTarget: "commonjs2",
        clean: {
            keep: "types",
        },
    },
    resolve: {
        extensions: [".ts", ".js"],
        extensionAlias: {
            ".js": [".ts", ".js"],
            ".mjs": [".mts", ".mjs"],
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: {
                    loader: "ts-loader",
                    options: {
                        configFile: path.resolve(__dirname, "tsconfig.build.json"),
                    },
                },
            },
        ],
    },
    externals: [nodeExternals()],
};
