/// <reference types="vite/client" />
import "../styles/global.css";
import React from "react";
import { createRoot } from "react-dom/client";

type AppModule = Record<string, React.ComponentType>;

// Auto-import all app components using Vite's glob import
// Each app folder must have an index.ts that exports the component matching the folder name
const appModules: Record<string, AppModule> = import.meta.glob("../apps/*/index.ts", {
    eager: true,
});

const apps: Record<string, React.ComponentType> = {};

for (const [path, module] of Object.entries(appModules)) {
    const match = path.match(/\.\.\/apps\/([^/]+)\/index\.ts$/);
    if (match) {
        const appName = match[1];
        if (!appName) continue;
        const Component = module[appName];
        if (Component) {
            apps[appName] = Component;
        } else {
            console.warn(
                `[mount] App "${appName}" not found in ${path}. ` +
                    `Make sure to export it as: export { ${appName} } from "./${appName}.js"`
            );
        }
    }
}

function mount(): void {
    const container = document.getElementById("root");
    if (!container) {
        console.error("[mount] No #root element found");
        return;
    }

    const componentName = container.dataset.component;
    if (!componentName) {
        console.error("[mount] No data-component attribute found on #root");
        return;
    }

    const Component = apps[componentName];
    if (!Component) {
        console.error(`[mount] Unknown app: ${componentName}`);
        console.error(`[mount] Available apps: ${Object.keys(apps).join(", ")}`);
        return;
    }

    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <Component />
        </React.StrictMode>
    );
}

mount();
