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
        // For both cli and lib, we want to output CommonJS modules because
        // vscode extension unfortunately still uses classic node module
        // resolution and to be able to use our mcp exports there we need to
        // compile to CommonJS.
        //
        // The CLI entrypoint does not care if its CommonJS
        // or ESM so to keep configuration simple we compile both to CommonJS.
        libraryTarget: "commonjs2",
        clean: {
            // We emit types separately so if they are in the output directory
            // we want to keep them.
            keep: "types",
        },
    },
    resolve: {
        extensions: [".ts", ".js"],
        // This is necessary because our repo is a module and that requires us
        // to write complete path imports. This however does not resolve
        // correctly when inside the bundler which is why we use the
        // extensionAlias.
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
    plugins: [
        // This is necessary to make the CLI executable. We originally have this
        // in src/cli.ts but it gets erased during the bundling process.
        new webpack.BannerPlugin({
            banner: "#!/usr/bin/env node",
            raw: true,
            entryOnly: true,
            include: "cli",
        }),
    ],
};
